/**
 * Summary routes:
 *   POST /api/v1/summary/generate    — generate AI summary
 *   GET  /api/v1/summary/:id/download — download formatted summary
 *
 * Self-host edition: AI summaries available to any authenticated user.
 * Operator must provide ANTHROPIC_API_KEY or OPENAI_API_KEY in env — without the
 * key for the requested provider, generate fails fast with 503 (not a job that
 * silently fails later).
 *
 * The bundle comes either inline (`bundle`, CLI / API clients) or from a finished
 * export the caller owns (`exportId`, web UI) — the web never holds the bundle.
 *
 * Bảo mật C-2 (IDOR): tất cả route đều pass userId để enforce ownership.
 * getStatus() trả undefined khi userId không khớp → route trả 404.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Bundle } from '@fhirbridge/types';
import type { ApiConfig } from '../config.js';
import { SummaryService, type SummaryRequestOptions } from '../services/summary-service.js';
import type { ExportService } from '../services/export-service.js';
import { requireScope } from '../plugins/auth-plugin.js';
import { postSummaryGenerateSchema, getSummaryDownloadSchema } from '../schemas/summary-schemas.js';

interface SummaryGenerateBody {
  bundle?: Bundle;
  exportId?: string;
  summaryConfig?: Record<string, unknown>;
}

interface IdParams {
  id: string;
}

interface DownloadQuery {
  format?: 'markdown' | 'composition';
}

export interface SummaryRoutesOpts {
  config: ApiConfig;
  /** Pre-built service (redis + audit wired in index.ts); falls back to in-memory. */
  summaryService?: SummaryService;
  /** Resolves `exportId` → bundle, with the same ownership check as export download. */
  exportService?: Pick<ExportService, 'getStatus'>;
}

/** Env var that must be set for each provider — surfaced verbatim in the 503 message. */
const PROVIDER_KEY_ENV = { claude: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' } as const;

export async function summaryRoutes(
  fastify: FastifyInstance,
  opts: SummaryRoutesOpts,
): Promise<void> {
  const summaryService = opts.summaryService ?? new SummaryService();
  // AI_PROVIDER (anthropic|openai) chọn provider mặc định khi request không chỉ định.
  const defaultProvider: 'claude' | 'openai' =
    opts.config.aiProvider === 'openai' ? 'openai' : 'claude';

  // POST /api/v1/summary/generate
  fastify.post<{ Body: SummaryGenerateBody }>(
    '/api/v1/summary/generate',
    { schema: postSummaryGenerateSchema, preHandler: requireScope('summary:write') },
    async (request: FastifyRequest<{ Body: SummaryGenerateBody }>, reply: FastifyReply) => {
      const { exportId } = request.body;
      const summaryConfig = request.body.summaryConfig as SummaryRequestOptions | undefined;
      let bundle = request.body.bundle;
      const userId = request.authUser?.id ?? 'anonymous';

      if (!bundle && !exportId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'bundle or exportId is required',
        });
      }

      const provider = summaryConfig?.provider ?? defaultProvider;
      const apiKey = provider === 'openai' ? opts.config.openaiApiKey : opts.config.anthropicApiKey;
      if (!apiKey) {
        return reply.status(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: `AI summaries are not configured on this server: set ${PROVIDER_KEY_ENV[provider]} and restart the API`,
        });
      }

      if (!bundle) {
        // IDOR: getStatus() enforces ownership — someone else's export is a plain 404.
        const exportRecord = exportId
          ? await opts.exportService?.getStatus(exportId, userId)
          : undefined;
        if (!exportRecord) {
          return reply
            .status(404)
            .send({ statusCode: 404, error: 'Not Found', message: 'Export not found' });
        }
        if (exportRecord.status !== 'complete' || !exportRecord.bundle) {
          return reply.status(409).send({
            statusCode: 409,
            error: 'Conflict',
            message: `Export is ${exportRecord.status}`,
          });
        }
        bundle = exportRecord.bundle;
      }

      const summaryId = await summaryService.startGeneration({
        bundle,
        summaryConfig: { ...summaryConfig, provider },
        hmacSecret: opts.config.hmacSecret,
        userId,
      });

      return reply.status(202).send({ summaryId, status: 'processing' });
    },
  );

  // GET /api/v1/summary/:id/download
  fastify.get<{ Params: IdParams; Querystring: DownloadQuery }>(
    '/api/v1/summary/:id/download',
    { schema: getSummaryDownloadSchema, preHandler: requireScope('summary:read') },
    async (
      request: FastifyRequest<{ Params: IdParams; Querystring: DownloadQuery }>,
      reply: FastifyReply,
    ) => {
      // IDOR protection: pass userId so getStatus() enforces ownership
      const callerUserId = request.authUser?.id ?? 'anonymous';
      const record = await summaryService.getStatus(request.params.id, callerUserId);
      if (!record) {
        return reply
          .status(404)
          .send({ statusCode: 404, error: 'Not Found', message: 'Summary not found' });
      }
      if (record.status === 'failed') {
        // Surface the failure — a 409 here made clients poll a dead job forever.
        return reply.status(502).send({
          statusCode: 502,
          error: 'Bad Gateway',
          message: `Summary generation failed: ${record.error ?? 'unknown error'}`,
        });
      }
      if (record.status !== 'complete' || !record.summary) {
        return reply
          .status(409)
          .send({ statusCode: 409, error: 'Conflict', message: `Summary is ${record.status}` });
      }

      const format = request.query.format ?? 'markdown';
      if (format === 'composition') {
        reply.header('Content-Type', 'application/fhir+json');
        reply.header('Content-Disposition', 'attachment; filename=summary-composition.json');
        return reply.send(JSON.stringify(record.summary));
      }

      reply.header('Content-Type', 'text/markdown; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename=patient-summary.md');
      return reply.send(record.formattedMarkdown ?? '');
    },
  );
}
