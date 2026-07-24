/**
 * Connector routes:
 *   POST /api/v1/connectors/test    — test HIS connection
 *   POST /api/v1/connectors/import  — upload CSV/Excel for import (multipart)
 */

import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';

import {
  FhirEndpointConnector,
  BundleBuilder,
  CsvConnector,
  ExcelConnector,
  validateBaseUrl,
} from '@fhirbridge/core';
import type { FhirEndpointConfig, Resource, ColumnMapping } from '@fhirbridge/types';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { requireScope } from '../plugins/auth-plugin.js';
import { postConnectorTestSchema } from '../schemas/connector-schemas.js';

interface ConnectorTestBody {
  type: 'fhir-endpoint';
  config: FhirEndpointConfig;
}

/** MIME types Excel */
const EXCEL_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
]);

/**
 * Phát hiện loại file từ extension và MIME type để dispatch đúng connector.
 * Extension đi trước: Firefox/WebKit trên Windows gửi .csv với MIME
 * 'application/vnd.ms-excel' (registry mapping cũ) — tin MIME trước sẽ đẩy
 * CSV vào ExcelConnector (unzipper) và nổ FILE_ENDED.
 */
function detectFileType(filename: string, mimetype: string): 'excel' | 'csv' | null {
  const ext = extname(filename).toLowerCase();
  if (ext === '.csv') return 'csv';
  if (ext === '.xlsx' || ext === '.xls') return 'excel';
  if (EXCEL_MIME_TYPES.has(mimetype)) return 'excel';
  if (mimetype === 'text/csv' || mimetype === 'text/plain') return 'csv';
  return null;
}

export async function connectorRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/v1/connectors/test
  fastify.post<{ Body: ConnectorTestBody }>(
    '/api/v1/connectors/test',
    { schema: postConnectorTestSchema, preHandler: requireScope('connector:write') },
    async (request: FastifyRequest<{ Body: ConnectorTestBody }>, reply: FastifyReply) => {
      const { config } = request.body;

      try {
        // Dùng centralised SSRF validator từ @fhirbridge/core
        const ssrfCheck = validateBaseUrl(config.baseUrl);
        if (!ssrfCheck.ok) {
          // Normalize error messages để backward-compatible với API contract đã có
          const reason = ssrfCheck.reason;
          const normalized =
            reason.includes('private/loopback') || reason.includes('Private IP')
              ? 'Private IP ranges are not allowed'
              : reason.includes('is blocked') || reason.includes('blocked')
                ? 'Internal endpoints are not allowed'
                : reason;
          throw new Error(normalized);
        }
        const connector = new FhirEndpointConnector();
        const connectorCfg = { ...config, type: 'fhir-endpoint' as const };
        await connector.connect(connectorCfg);
        const status = await connector.testConnection();
        await connector.disconnect();
        return reply.send(status);
      } catch (err) {
        return reply.send({
          connected: false,
          error: err instanceof Error ? err.message : 'Connection test failed',
          checkedAt: new Date().toISOString(),
        });
      }
    },
  );

  // POST /api/v1/connectors/import — multipart CSV/Excel upload → FHIR Bundle
  fastify.post(
    '/api/v1/connectors/import',
    { preHandler: requireScope('connector:write') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.isMultipart()) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Expected multipart/form-data',
        });
      }

      // Tạo temp file với extension tạm — sẽ rename sau khi biết loại file
      const tempId = randomUUID();
      const tempFile = join(tmpdir(), `fhirbridge-import-${tempId}.tmp`);
      try {
        const parts = request.parts();
        let mappingConfig: Record<string, unknown> | undefined;
        let uploadedFilename = '';
        let uploadedMimetype = '';

        for await (const part of parts) {
          if (part.type === 'file') {
            uploadedFilename = part.filename ?? '';
            uploadedMimetype = part.mimetype ?? '';
            // Stream file to temp location
            const writeStream = createWriteStream(tempFile);
            await streamPipeline(part.file, writeStream);
          } else if (part.fieldname === 'mapping') {
            mappingConfig = JSON.parse(part.value as string);
          }
        }

        // Phát hiện loại file từ MIME + extension
        const fileType = detectFileType(uploadedFilename, uploadedMimetype);
        if (!fileType) {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: `Unsupported file type '${uploadedMimetype}' (filename: '${uploadedFilename}'). Use .csv, .xlsx, or .xls`,
          });
        }

        const columnMapping = (mappingConfig?.['columns'] as ColumnMapping[] | undefined) ?? [];

        // Dispatch đúng connector theo loại file (C-13)
        const builder = new BundleBuilder();
        let resourceCount = 0;

        if (fileType === 'excel') {
          const connector = new ExcelConnector();
          await connector.connect({
            type: 'excel',
            filePath: tempFile,
            mapping: columnMapping,
          });
          for await (const record of connector.fetchPatientData('*')) {
            if (++resourceCount > 10_000) break; // Safety limit
            builder.addResource(record.data as unknown as Resource);
          }
          await connector.disconnect();
        } else {
          const connector = new CsvConnector();
          await connector.connect({
            type: 'csv',
            filePath: tempFile,
            mapping: columnMapping,
          });
          for await (const record of connector.fetchPatientData('*')) {
            if (++resourceCount > 10_000) break; // Safety limit
            builder.addResource(record.data as unknown as Resource);
          }
          await connector.disconnect();
        }

        const bundle = builder.build();
        return reply.status(200).send({
          message: 'Import complete',
          resourceCount: bundle.entry?.length ?? 0,
          bundle,
        });
      } catch (err) {
        // Log server-side để chẩn đoán — message trả client giữ generic (không leak chi tiết).
        request.log.error({ err }, 'File import processing failed');
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'File import processing failed',
        });
      } finally {
        // Cleanup temp file — privacy: no PHI persisted
        await unlink(tempFile).catch(() => {});
      }
    },
  );
}
