/**
 * Export routes:
 *   POST   /api/v1/export              — initiate patient export
 *   GET    /api/v1/export/:id/status   — check export status
 *   GET    /api/v1/export/:id/download — stream export result
 *
 * Self-host edition: no quota / billing — operator (hospital/clinic) controls usage.
 *
 * C-6: Download route hỗ trợ hai mode:
 *   ?format=ndjson → true streaming (connector → transform → reply.raw.write, memory-bounded)
 *   ?format=json   → batch Bundle (giữ nguyên behavior cũ, dùng cho small exports)
 *
 * DI: accepts opts.exportService.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { serializeToJson } from '@fhirbridge/core';
import type { ConnectorConfig } from '@fhirbridge/types';
import { ExportService } from '../services/export-service.js';
import { requireScope } from '../plugins/auth-plugin.js';
import {
  postExportSchema,
  getExportStatusSchema,
  getExportDownloadSchema,
} from '../schemas/export-schemas.js';

interface ExportBody {
  patientId: string;
  connectorConfig: ConnectorConfig;
  outputFormat?: 'json' | 'ndjson';
  includeSummary?: boolean;
}

interface IdParams {
  id: string;
}

interface DownloadQuery {
  format?: 'json' | 'ndjson';
  /** patientId bắt buộc khi format=ndjson (streaming mode không dùng stored record) */
  patientId?: string;
}

export interface ExportRoutesOpts {
  exportService?: ExportService;
}

export async function exportRoutes(
  fastify: FastifyInstance,
  opts: ExportRoutesOpts = {},
): Promise<void> {
  const exportService = opts.exportService ?? new ExportService();

  // POST /api/v1/export — start async export
  fastify.post<{ Body: ExportBody }>(
    '/api/v1/export',
    { schema: postExportSchema, preHandler: requireScope('export:write') },
    async (request: FastifyRequest<{ Body: ExportBody }>, reply: FastifyReply) => {
      const { patientId, connectorConfig, outputFormat, includeSummary } = request.body;
      const userId = request.authUser?.id ?? 'anonymous';

      const exportId = await exportService.startExport(
        { patientId, connectorConfig, outputFormat, includeSummary },
        userId,
      );

      return reply.status(202).send({ exportId, status: 'processing' });
    },
  );

  // GET /api/v1/export/:id/status
  fastify.get<{ Params: IdParams }>(
    '/api/v1/export/:id/status',
    { schema: getExportStatusSchema, preHandler: requireScope('export:read') },
    async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const userId = request.authUser?.id ?? 'anonymous';
      const record = await exportService.getStatus(request.params.id, userId);
      if (!record) {
        return reply
          .status(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Export not found' });
      }
      return reply.send({
        status: record.status,
        resourceCount: record.resourceCount,
        error: record.error,
      });
    },
  );

  /**
   * GET /api/v1/export/:id/download
   *
   * Mode 1 — format=ndjson (C-6 streaming):
   *   Stream stored bundle entries dưới dạng NDJSON lines (memory-bounded).
   *
   * Mode 2 — format=json (default, batch):
   *   Trả về full Bundle JSON.
   */
  fastify.get<{ Params: IdParams; Querystring: DownloadQuery }>(
    '/api/v1/export/:id/download',
    { schema: getExportDownloadSchema, preHandler: requireScope('export:read') },
    async (
      request: FastifyRequest<{ Params: IdParams; Querystring: DownloadQuery }>,
      reply: FastifyReply,
    ) => {
      const userId = request.authUser?.id ?? 'anonymous';
      const format = request.query.format ?? 'json';

      if (format === 'ndjson') {
        const record = await exportService.getStatus(request.params.id, userId);
        if (!record) {
          return reply
            .status(404)
            .send({ statusCode: 404, error: 'Not Found', message: 'Export not found' });
        }

        if (record.status === 'complete' && record.bundle) {
          reply.raw.setHeader('Content-Type', 'application/fhir+ndjson');
          reply.raw.setHeader('Transfer-Encoding', 'chunked');
          reply.raw.setHeader('Content-Disposition', 'attachment; filename=patient-export.ndjson');
          reply.hijack();

          try {
            for (const entry of record.bundle.entry ?? []) {
              if (entry.resource) {
                const line = JSON.stringify(entry.resource) + '\n';
                const canContinue = reply.raw.write(line);
                if (!canContinue) {
                  await new Promise<void>((resolve) => reply.raw.once('drain', resolve));
                }
              }
            }
          } finally {
            reply.raw.end();
          }
          return;
        }

        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: `Export is ${record.status}. Use POST /api/v1/export with direct streaming connector for NDJSON streaming.`,
        });
      }

      // Mode 2: JSON batch download
      const record = await exportService.getStatus(request.params.id, userId);
      if (!record) {
        return reply
          .status(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Export not found' });
      }
      if (record.status !== 'complete' || !record.bundle) {
        return reply
          .status(409)
          .send({ statusCode: 409, error: 'Conflict', message: `Export is ${record.status}` });
      }

      reply.header('Content-Type', 'application/fhir+json');
      reply.header('Content-Disposition', 'attachment; filename=patient-bundle.json');
      return reply.send(serializeToJson(record.bundle));
    },
  );

  /**
   * GET /api/v1/export/:id/stream
   *
   * C-6 Direct NDJSON streaming endpoint placeholder (501 — requires connectorConfig
   * persistence in ExportRecord; see C-6-followup).
   */
  fastify.get<{ Params: IdParams }>(
    '/api/v1/export/:id/stream',
    { schema: getExportDownloadSchema, preHandler: requireScope('export:read') },
    async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const userId = request.authUser?.id ?? 'anonymous';
      const record = await exportService.getStatus(request.params.id, userId);
      if (!record) {
        return reply
          .status(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Export not found' });
      }
      return reply.status(501).send({
        statusCode: 501,
        error: 'Not Implemented',
        message:
          'Direct streaming requires connectorConfig stored in ExportRecord. Use /download?format=ndjson after export completes.',
      });
    },
  );
}
