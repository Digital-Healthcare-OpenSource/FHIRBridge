/**
 * Connector routes:
 *   POST /api/v1/connectors/test    — test HIS connection
 *   POST /api/v1/connectors/import  — upload CSV/Excel + column mapping (multipart) → FHIR Bundle
 */

import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';

import {
  FhirEndpointConnector,
  ConnectorError,
  MappingConfigError,
  TabularImportError,
  formatImportIssue,
  importTabularFile,
  parseMappingConfig,
  validateBaseUrl,
} from '@fhirbridge/core';
import type { FhirEndpointConfig, ImportMapping } from '@fhirbridge/types';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { requireScope } from '../plugins/auth-plugin.js';
import {
  IMPORT_FIELDS,
  MAPPING_REQUIRED_MESSAGE,
  MAX_IMPORT_RESOURCES,
  MAX_IMPORT_WARNINGS,
  MAX_MAPPING_BYTES,
  postConnectorImportSchema,
  postConnectorTestSchema,
} from '../schemas/connector-schemas.js';

interface ConnectorTestBody {
  type: 'fhir-endpoint';
  config: FhirEndpointConfig;
}

export interface ConnectorRoutesOptions {
  /**
   * HMAC secret for hashing Korean RRNs during import (PIPA). Falls back to
   * process.env.HMAC_SECRET (required by the API config); without either RRNs
   * are masked — never emitted raw.
   */
  hmacSecret?: string;
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

/** Client error carrying an HTTP status; message is safe to return (no PHI). */
class ImportRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  413: 'Payload Too Large',
  422: 'Unprocessable Entity',
};

/**
 * Read a (small) file part, keeping at most `limit` bytes. Vượt limit thì vẫn
 * drain hết part (không destroy stream giữa chừng) rồi mới báo lỗi.
 */
async function readLimited(stream: Readable, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += (chunk as Buffer).length;
    if (size <= limit) chunks.push(chunk as Buffer);
  }
  if (size > limit) throw new ImportRequestError(413, `Mapping exceeds ${limit} bytes`);
  return Buffer.concat(chunks).toString('utf8');
}

/** Map core/connector errors to HTTP responses; unknown errors → undefined (500). */
function toRequestError(err: unknown): ImportRequestError | undefined {
  if (err instanceof ImportRequestError) return err;
  if (err instanceof MappingConfigError) {
    return new ImportRequestError(400, err.message, { issues: err.issues });
  }
  if (err instanceof TabularImportError) {
    const status =
      err.code === 'RESOURCE_LIMIT' ? 413 : err.code === 'NO_MATCHING_COLUMNS' ? 422 : 400;
    return new ImportRequestError(status, err.message);
  }
  if (err instanceof ConnectorError) {
    if (err.code === 'ROW_LIMIT' || err.code === 'FILE_TOO_LARGE') {
      return new ImportRequestError(413, err.message);
    }
    if (err.code === 'SHEET_NOT_FOUND' || err.code === 'NO_SHEET') {
      return new ImportRequestError(422, err.message);
    }
  }
  const code = (err as { code?: unknown })?.code;
  if (
    code === 'FST_REQ_FILE_TOO_LARGE' ||
    code === 'FST_FILES_LIMIT' ||
    code === 'FST_PARTS_LIMIT'
  ) {
    return new ImportRequestError(413, 'Upload exceeds the server limit');
  }
  return undefined;
}

export async function connectorRoutes(
  fastify: FastifyInstance,
  opts: ConnectorRoutesOptions = {},
): Promise<void> {
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

  // POST /api/v1/connectors/import — multipart CSV/Excel upload + mapping → FHIR Bundle
  fastify.post(
    '/api/v1/connectors/import',
    { schema: postConnectorImportSchema, preHandler: requireScope('connector:write') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.isMultipart()) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Expected multipart/form-data',
        });
      }

      // Thư mục tạm riêng (mkdtemp → 0700, tên ngẫu nhiên) + file ghi độc quyền 0600 —
      // không bao giờ dùng filename của client làm path, không đoán/chiếm được từ user khác.
      const tempDir = await mkdtemp(join(tmpdir(), 'fhirbridge-import-'));
      const tempFile = join(tempDir, 'upload.tmp');
      const respond = (statusCode: number, body: unknown) => ({ statusCode, body });
      const response = await (async () => {
        try {
          let mappingText: string | undefined;
          let sheet: string | undefined;
          let uploadedFilename = '';
          let uploadedMimetype = '';
          let hasFile = false;
          // Lỗi client ghi lại rồi tiếp tục drain các part còn lại — không bỏ dở stream multipart
          let partError: ImportRequestError | undefined;

          for await (const part of request.parts()) {
            if (part.type === 'file') {
              if (partError) {
                part.file.resume();
              } else if (part.fieldname === IMPORT_FIELDS.mapping) {
                try {
                  mappingText = await readLimited(part.file, MAX_MAPPING_BYTES);
                } catch (err) {
                  if (!(err instanceof ImportRequestError)) throw err;
                  partError = err;
                }
              } else if (part.fieldname === IMPORT_FIELDS.file && !hasFile) {
                hasFile = true;
                uploadedFilename = part.filename ?? '';
                uploadedMimetype = part.mimetype ?? '';
                await streamPipeline(
                  part.file,
                  createWriteStream(tempFile, { flags: 'wx', mode: 0o600 }),
                );
              } else {
                part.file.resume();
                partError = new ImportRequestError(
                  400,
                  part.fieldname === IMPORT_FIELDS.file
                    ? 'Only one "file" part is allowed per import'
                    : `Unexpected file field "${part.fieldname}" — send the data file as "file" and the mapping as "mapping"`,
                );
              }
            } else if (part.fieldname === IMPORT_FIELDS.mapping) {
              if (part.valueTruncated) {
                partError ??= new ImportRequestError(
                  413,
                  'Mapping field exceeds the server field-size limit',
                );
              } else {
                mappingText = String(part.value);
              }
            } else if (part.fieldname === IMPORT_FIELDS.sheet && String(part.value).trim()) {
              sheet = String(part.value).trim();
            }
          }

          if (partError) throw partError;
          if (!hasFile) {
            throw new ImportRequestError(
              400,
              'No file uploaded — send the CSV/.xlsx as the multipart field "file"',
            );
          }

          // Phát hiện loại file từ MIME + extension
          const fileType = detectFileType(uploadedFilename, uploadedMimetype);
          if (!fileType) {
            return respond(400, {
              statusCode: 400,
              error: 'Bad Request',
              message: `Unsupported file type '${uploadedMimetype}' (filename: '${uploadedFilename}'). Use .csv or .xlsx (legacy .xls is not supported — save it as .xlsx)`,
            });
          }

          if (mappingText === undefined || mappingText.trim() === '') {
            throw new ImportRequestError(400, MAPPING_REQUIRED_MESSAGE);
          }
          const mapping: ImportMapping = parseMappingConfig(mappingText);

          const hmacSecret = opts.hmacSecret ?? process.env['HMAC_SECRET'];
          const result = await importTabularFile({
            filePath: tempFile,
            fileType,
            mapping,
            maxResources: MAX_IMPORT_RESOURCES,
            ...(sheet ? { sheet } : {}),
            ...(hmacSecret ? { rrnSecret: hmacSecret } : {}),
          });

          const warnings = result.issues.slice(0, MAX_IMPORT_WARNINGS).map(formatImportIssue);
          const summary = {
            resourcesByType: result.stats.resourcesByType,
            rowsRead: result.stats.rowsRead,
            warnings,
            warningCount: result.issues.length,
            ...(mapping.notices.length > 0 ? { mappingNotices: mapping.notices } : {}),
          };

          if (result.resourceCount === 0) {
            throw new ImportRequestError(
              422,
              `No FHIR resources were produced from ${result.stats.rowsRead} row(s). ` +
                'Check that the mapping columns match the file header (see "warnings").',
              summary,
            );
          }

          return respond(200, {
            message: 'Import complete',
            resourceCount: result.resourceCount,
            ...summary,
            bundle: result.bundle,
          });
        } catch (err) {
          const clientError = toRequestError(err);
          if (clientError) {
            return respond(clientError.statusCode, {
              statusCode: clientError.statusCode,
              error: STATUS_TEXT[clientError.statusCode] ?? 'Bad Request',
              message: clientError.message,
              ...clientError.extra,
            });
          }
          // Log server-side để chẩn đoán — message trả client giữ generic (không leak chi tiết).
          request.log.error({ err }, 'File import processing failed');
          return respond(500, {
            statusCode: 500,
            error: 'Internal Server Error',
            message: 'File import processing failed',
          });
        } finally {
          // Cleanup temp dir + file BEFORE replying — privacy: once the client has its
          // answer, no uploaded PHI is left on disk.
          await rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
      })();
      return reply.status(response.statusCode).send(response.body);
    },
  );
}
