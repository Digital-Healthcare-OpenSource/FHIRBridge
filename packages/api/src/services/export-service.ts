/**
 * Export service — orchestrates connector → bundle assembly.
 * Job-record lifecycle được uỷ cho JobRecordStore (redis-or-memory, TTL, sweep,
 * ownership + audit) — service class giữ mỏng.
 * No PHI in service-level logs.
 *
 * C-6: streamExport() cho NDJSON streaming trực tiếp.
 * Memory-bounded — không gom resource array, stream-through only.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  FhirEndpointConnector,
  BundleBuilder,
  serializeResourceAsNdjsonLine,
  validateBaseUrlWithDns,
  validateResource,
} from '@fhirbridge/core';
import type { Bundle, ConnectorConfig, Resource } from '@fhirbridge/types';
import type { IRedisStore } from './redis-store.js';
import type { AuditService } from './audit-service.js';
import { JobRecordStore, hashUserId } from './job-record-store.js';

export interface ExportRequest {
  patientId: string;
  connectorConfig: ConnectorConfig;
  outputFormat?: 'json' | 'ndjson';
  includeSummary?: boolean;
}

export type ExportStatus = 'processing' | 'complete' | 'failed';

export interface ExportRecord {
  status: ExportStatus;
  userId: string;
  bundle?: Bundle;
  resourceCount?: number;
  error?: string;
  createdAt: number;
}

/** Tham số cho streamExport */
export interface StreamExportOpts {
  patientId: string;
  connectorConfig: ConnectorConfig;
  userId: string;
}

/** Maximum resources per export to prevent OOM */
const MAX_RESOURCES = 10_000;

/** ~5 MB threshold for skipping Redis (large bundles stay in-memory) */
const MAX_REDIS_BYTES = 5 * 1024 * 1024;

/** TTL for export records: 10 minutes */
const EXPORT_TTL_SECONDS = 10 * 60;

export interface ExportServiceDeps {
  /** Optional Redis store; falls back to in-memory when absent */
  redis?: IRedisStore;
  /** Optional logger; defaults to console.warn/error when absent */
  logger?: { warn(msg: string): void; error(msg: string): void };
  /** Optional audit service — bật audit cho cross-tenant denial trong getStatus */
  audit?: AuditService;
  /** HMAC key để hash userId trong audit; mặc định process.env.HMAC_SECRET */
  auditHashSalt?: string;
}

export class ExportService {
  private readonly store: JobRecordStore<ExportRecord>;
  private readonly logger: { warn(msg: string): void; error(msg: string): void };
  private readonly auditHashKey: string;

  /**
   * @param optsOrRedis - Either an ExportServiceDeps object (preferred DI form)
   *   or a bare IRedisStore for backward compatibility with existing callers.
   */
  constructor(optsOrRedis?: IRedisStore | ExportServiceDeps) {
    let redis: IRedisStore | null = null;
    let logger: { warn(msg: string): void; error(msg: string): void } = console;
    let audit: AuditService | undefined;
    let auditHashSalt: string | undefined;

    if (!optsOrRedis) {
      // defaults
    } else if ('set' in optsOrRedis && 'get' in optsOrRedis) {
      redis = optsOrRedis as IRedisStore;
    } else {
      const deps = optsOrRedis as ExportServiceDeps;
      redis = deps.redis ?? null;
      logger = deps.logger ?? console;
      audit = deps.audit;
      auditHashSalt = deps.auditHashSalt;
    }

    this.logger = logger;
    this.auditHashKey =
      auditHashSalt ?? process.env['HMAC_SECRET'] ?? 'dev-only-fallback-salt-32-chars-min';

    this.store = new JobRecordStore<ExportRecord>({
      redis,
      logger,
      ttlSeconds: EXPORT_TTL_SECONDS,
      maxRedisBytes: MAX_REDIS_BYTES,
      ...(audit
        ? {
            audit: {
              service: audit,
              hashKey: this.auditHashKey,
              deniedAction: 'export_access_denied',
              idField: 'export_id',
            },
          }
        : {}),
    });
  }

  /** Kick off async export. Returns exportId immediately (202 pattern). */
  async startExport(request: ExportRequest, userId: string): Promise<string> {
    const exportId = randomUUID();
    const record: ExportRecord = { status: 'processing', userId, createdAt: Date.now() };
    await this.store.set(exportId, record);
    this.runExport(exportId, request, userId).catch(() => {
      /* errors stored in record */
    });
    return exportId;
  }

  /** Get current status of an export job — verifies ownership + audits denials */
  async getStatus(exportId: string, userId: string): Promise<ExportRecord | undefined> {
    return this.store.getOwned(exportId, userId);
  }

  /** Internal: run the full export pipeline */
  private async runExport(exportId: string, request: ExportRequest, userId: string): Promise<void> {
    // MEDIUM: handle undefined explicitly — record có thể biến mất (TTL/eviction/redis flush)
    // trước khi pipeline chạy. Ghi một record 'failed' mới thay vì crash với non-null assert.
    const existing = await this.store.get(exportId);
    if (!existing) {
      this.logger.warn(
        `[ExportService] record ${exportId} missing before run; writing fresh failed record`,
      );
      await this.store.set(exportId, {
        status: 'failed',
        userId,
        createdAt: Date.now(),
        error: 'Export record expired before processing',
      });
      return;
    }

    try {
      if ('baseUrl' in request.connectorConfig) {
        // C5: DNS-aware SSRF — resolve hostname và validate IP đã resolve trước khi connect.
        const ssrfResult = await validateBaseUrlWithDns(request.connectorConfig.baseUrl as string);
        if (!ssrfResult.ok) {
          throw new Error(ssrfResult.reason);
        }
      }

      const connector = new FhirEndpointConnector();
      await connector.connect(request.connectorConfig);

      const builder = new BundleBuilder();
      let resourceCount = 0;
      for await (const rawRecord of connector.fetchPatientData(request.patientId)) {
        if (++resourceCount > MAX_RESOURCES) {
          throw new Error(`Export exceeded maximum of ${MAX_RESOURCES} resources`);
        }
        // MEDIUM: validate connector output thay vì cast mù `as unknown as Resource`.
        // skipOnError — bỏ qua record malformed thay vì nhét vào bundle.
        const candidate = rawRecord.data as unknown;
        const validation = validateResource(candidate);
        if (!validation.valid) {
          this.logger.warn(
            `[ExportService] skipping invalid resource in export ${exportId} (no PHI)`,
          );
          continue;
        }
        builder.addResource(candidate as Resource);
      }

      await connector.disconnect();

      const bundle = builder.build();
      // Immutable update — không mutate record có thể đang được chia sẻ.
      const completed: ExportRecord = {
        ...existing,
        bundle,
        resourceCount: bundle.entry?.length ?? 0,
        status: 'complete',
      };
      await this.store.set(exportId, completed);
    } catch (err) {
      const failed: ExportRecord = {
        ...existing,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Export failed',
      };
      await this.store.set(exportId, failed);
    }
  }

  /**
   * C-6: True NDJSON streaming export — stream resources trực tiếp từ connector đến response.
   *
   * Memory invariant: không gom resource array vào memory.
   * Mỗi resource được serialize thành NDJSON line và write ngay đến reply.raw.
   */
  async streamExport(
    request: FastifyRequest,
    reply: FastifyReply,
    opts: StreamExportOpts,
  ): Promise<void> {
    const { patientId, connectorConfig, userId } = opts;
    const startTime = Date.now();
    let resourceCount = 0;

    // IDOR protection: verify userId khớp với authenticated user
    const authUserId = request.authUser?.id ?? 'anonymous';
    if (authUserId !== userId) {
      reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Access denied',
      });
      return;
    }

    if ('baseUrl' in connectorConfig) {
      // C5: DNS-aware SSRF cũng áp cho streaming path.
      const ssrfResult = await validateBaseUrlWithDns(connectorConfig.baseUrl as string);
      if (!ssrfResult.ok) {
        reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: ssrfResult.reason,
        });
        return;
      }
    }

    const abortController = new AbortController();
    const { signal } = abortController;

    const onClose = (): void => {
      abortController.abort();
    };
    reply.raw.on('close', onClose);

    reply.raw.setHeader('Content-Type', 'application/fhir+ndjson');
    reply.raw.setHeader('Transfer-Encoding', 'chunked');
    reply.raw.setHeader('Content-Disposition', 'attachment; filename=patient-export.ndjson');
    reply.hijack();

    const connector = new FhirEndpointConnector();

    try {
      await connector.connect(connectorConfig);

      for await (const rawRecord of connector.fetchPatientData(patientId)) {
        if (signal.aborted) break;

        if (++resourceCount > MAX_RESOURCES) {
          const outcome =
            JSON.stringify({
              resourceType: 'OperationOutcome',
              issue: [
                {
                  severity: 'error',
                  code: 'too-costly',
                  details: { text: `Export exceeded maximum of ${MAX_RESOURCES} resources` },
                },
              ],
            }) + '\n';
          await writeChunk(reply.raw, outcome);
          break;
        }

        // MEDIUM: validate trước khi ship — emit OperationOutcome per bad record (skipOnError).
        const candidate = rawRecord.data as unknown;
        const validation = validateResource(candidate);
        if (!validation.valid) {
          const outcome =
            JSON.stringify({
              resourceType: 'OperationOutcome',
              issue: [
                {
                  severity: 'error',
                  code: 'invalid',
                  details: { text: 'Skipped malformed resource in export stream' },
                },
              ],
            }) + '\n';
          await writeChunk(reply.raw, outcome);
          continue;
        }

        const line = serializeResourceAsNdjsonLine(candidate as Resource);

        const drained = await writeChunk(reply.raw, line);
        if (!drained) {
          await waitForDrain(reply.raw, signal);
        }
      }

      await connector.disconnect();
    } catch (err) {
      if (!signal.aborted) {
        const errorMessage = err instanceof Error ? err.message : 'Export failed';
        this.logger.error(`[ExportService] streamExport error (no PHI): ${errorMessage}`);

        const outcome =
          JSON.stringify({
            resourceType: 'OperationOutcome',
            issue: [
              {
                severity: 'error',
                code: 'exception',
                details: { text: 'Export stream encountered an error' },
              },
            ],
          }) + '\n';

        try {
          await writeChunk(reply.raw, outcome);
        } catch {
          // Ignore write errors after stream failure
        }
      }
    } finally {
      reply.raw.removeListener('close', onClose);

      const duration = Date.now() - startTime;
      const userIdHash = hashUserId(userId, this.auditHashKey);
      process.nextTick(() => {
        const line = JSON.stringify({
          audit: true,
          ts: new Date().toISOString(),
          user: userIdHash,
          action: 'export.stream',
          status: signal.aborted ? 'aborted' : 'success',
          resources: resourceCount,
          durationMs: duration,
        });
        process.stdout.write(line + '\n');
      });

      reply.raw.end();
    }
  }
}

/**
 * Write một chunk vào NodeJS writable stream với backpressure support.
 * Trả về true nếu buffer chưa đầy (có thể write tiếp ngay),
 * false nếu cần đợi drain event.
 */
function writeChunk(stream: NodeJS.WritableStream, data: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const canContinue = stream.write(data, (err) => {
      if (err) reject(err);
    });
    resolve(canContinue);
  });
}

/**
 * Đợi 'drain' NHƯNG race với 'close'/'error' và abort signal.
 * HIGH fix: nếu client disconnect lúc backpressure, 'drain' không bao giờ fire —
 * promise sẽ treo vĩnh viễn và finally không chạy (connector + PHI buffer leak).
 * Ở đây ta settle trên bất kỳ điều kiện nào và gỡ listener sau khi settle.
 */
function waitForDrain(stream: NodeJS.WritableStream, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const emitter = stream as unknown as NodeJS.EventEmitter;

    const cleanup = (): void => {
      emitter.removeListener('drain', onSettle);
      emitter.removeListener('close', onSettle);
      emitter.removeListener('error', onSettle);
      signal.removeEventListener('abort', onSettle);
    };
    const onSettle = (): void => {
      cleanup();
      resolve();
    };

    emitter.once('drain', onSettle);
    emitter.once('close', onSettle);
    emitter.once('error', onSettle);
    signal.addEventListener('abort', onSettle, { once: true });
  });
}
