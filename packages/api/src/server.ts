/**
 * Fastify server factory.
 * Creates and configures a Fastify instance with all plugins and routes.
 * Does NOT start listening — call server.listen() from index.ts.
 *
 * Nhận ServerOpts để inject pre-built services vào từng route plugin.
 * Backward-compat: nếu opts là ApiConfig thuần, tự build sinks.
 */

import fastifyMultipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';

import type { ApiConfig } from './config.js';
import { registerErrorHandler } from './middleware/error-handler.js';
import { auditPlugin } from './plugins/audit-plugin.js';
import { authPlugin, InMemoryJtiDenylist, type IJtiDenylist } from './plugins/auth-plugin.js';
import { corsPlugin } from './plugins/cors-plugin.js';
import { idempotencyPlugin } from './plugins/idempotency-plugin.js';
import { ipRateLimiterPlugin } from './plugins/ip-rate-limiter-plugin.js';
import { metricsPlugin } from './plugins/metrics-plugin.js';
import { rateLimiterPlugin } from './plugins/rate-limiter-plugin.js';
import { requestIdPlugin } from './plugins/request-id-plugin.js';
import { securityHeadersPlugin } from './plugins/security-headers-plugin.js';
import { swaggerPlugin } from './plugins/swagger-plugin.js';
import { traceContextPlugin } from './plugins/trace-context-plugin.js';
import { authRoutes } from './routes/auth-routes.js';
import { consentRoutes } from './routes/consent-routes.js';
import { connectorRoutes } from './routes/connector-routes.js';
import { exportRoutes } from './routes/export-routes.js';
import { healthRoutes } from './routes/health-routes.js';
import { summaryRoutes } from './routes/summary-routes.js';
import { AuditService, ConsoleAuditSink } from './services/audit-service.js';
import { PostgresAuditSink } from './services/postgres-audit-sink.js';
import { AuditRetentionService } from './services/audit-retention-service.js';
import type { IRedisStore } from './services/redis-store.js';
import type { ExportService } from './services/export-service.js';
import type { SummaryService } from './services/summary-service.js';

/** Max upload size for multipart (50 MB) */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Dependency-injected options cho createServer.
 * Tất cả services đều optional — fallback to in-memory/console khi absent.
 */
export interface ServerOpts {
  config: ApiConfig;
  /** Audit sink — PostgresAuditSink trong prod, ConsoleAuditSink trong dev/test */
  auditSink?: PostgresAuditSink | InstanceType<typeof ConsoleAuditSink>;
  /** Redis-backed generic store — optional, falls back to in-memory */
  redisStore?: IRedisStore;
  /** Pre-built export service */
  exportService?: ExportService;
  /** Pre-built summary service */
  summaryService?: SummaryService;
}

/**
 * Create and configure Fastify instance.
 * Accepts either ServerOpts (DI form) or bare ApiConfig (backward-compat).
 *
 * Plugin registration order:
 *   swagger → securityHeaders → requestId → trace → metrics → cors → multipart
 *   → ipRateLimiter → auth → idempotency → rateLimiter → audit → routes
 *
 * swagger phải đứng trước routes để collect schemas.
 * securityHeaders đứng sớm để cover toàn bộ responses.
 * ipRateLimiter phải đứng TRƯỚC auth để chặn unauth flood / API-key brute-force.
 */
export async function createServer(optsOrConfig: ServerOpts | ApiConfig): Promise<FastifyInstance> {
  const opts: ServerOpts =
    'config' in optsOrConfig ? optsOrConfig : { config: optsOrConfig as ApiConfig };

  const { config } = opts;

  const fastify = Fastify({
    logger: { level: config.logLevel },
    requestIdHeader: 'x-request-id',
    trustProxy: config.trustProxy ?? false,
  });

  // ── Audit sink setup ──────────────────────────────────────────────────────────
  let postgresAuditSink: PostgresAuditSink | null = null;
  let resolvedAuditSink: InstanceType<typeof ConsoleAuditSink> | PostgresAuditSink;

  if (opts.auditSink) {
    resolvedAuditSink = opts.auditSink;
    if (opts.auditSink instanceof PostgresAuditSink) {
      postgresAuditSink = opts.auditSink;
    }
    fastify.log.info('[Server] using injected auditSink');
  } else if (config.databaseUrl) {
    postgresAuditSink = new PostgresAuditSink(config.databaseUrl);
    resolvedAuditSink = postgresAuditSink;
    fastify.log.info('[Server] using PostgresAuditSink');
  } else {
    resolvedAuditSink = new ConsoleAuditSink();
    fastify.log.info('[Server] using ConsoleAuditSink (no DATABASE_URL configured)');
  }

  const auditService = new AuditService(resolvedAuditSink);

  // ── Audit retention scheduler (opt-in) ──────────────────────────────────────
  // Chỉ chạy khi AUDIT_RETENTION_DAYS được set tường minh VÀ Postgres sink bật —
  // không auto-xoá audit data theo default (rủi ro compliance).
  let retentionService: AuditRetentionService | null = null;
  if (postgresAuditSink && config.auditRetentionDays != null) {
    retentionService = new AuditRetentionService(
      postgresAuditSink,
      config.auditRetentionDays,
      fastify.log,
    );
    retentionService.start();
    fastify.log.info(
      `[Server] audit retention scheduler enabled (${config.auditRetentionDays} days, daily purge)`,
    );
  }
  if (config.auditProfile === 'kr' && (config.auditRetentionDays ?? 0) < 730) {
    fastify.log.warn(
      '[Server] AUDIT_PROFILE=kr: 접속기록 phải giữ ≥ 2 năm — set AUDIT_RETENTION_DAYS=730 trở lên',
    );
  }

  // ── JWT revocation list (logout) ────────────────────────────────────────────────
  // Redis-backed when a store is available (survives across replicas); in-memory otherwise.
  let jtiDenylist: IJtiDenylist;
  if (opts.redisStore) {
    const store = opts.redisStore;
    jtiDenylist = {
      async isRevoked(jti: string): Promise<boolean> {
        return (await store.get<boolean>(`jti-denylist:${jti}`)) === true;
      },
      async revoke(jti: string, ttlSeconds: number): Promise<void> {
        await store.set(`jti-denylist:${jti}`, true, ttlSeconds);
      },
    };
  } else {
    jtiDenylist = new InMemoryJtiDenylist();
  }

  // 0a. Swagger/OpenAPI — trước routes để collect schemas
  await fastify.register(swaggerPlugin);

  // 0b. Security headers (helmet) — áp dụng sớm cho mọi response
  await fastify.register(securityHeadersPlugin);

  // 1. Request ID — must be first so subsequent plugins/hooks have it
  await fastify.register(requestIdPlugin);

  // 1b. W3C Trace Context (H-18)
  await fastify.register(traceContextPlugin);

  // 1c. Metrics (FR-O3)
  await fastify.register(metricsPlugin, { bearerToken: config.metricsBearerToken });

  // 2. CORS
  await fastify.register(corsPlugin, { config });

  // 3. Multipart support
  await fastify.register(fastifyMultipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES },
  });

  // 3b. IP-based rate limiter — MUST run before auth so unauthenticated floods and API-key
  // brute-force attempts are throttled (auth short-circuits 401 before the per-user limiter).
  await fastify.register(ipRateLimiterPlugin, {
    maxPerMinute: config.rateLimitPerMinute * 3,
  });

  // 4. Auth — validates JWT/API key
  await fastify.register(authPlugin, { config, jtiDenylist });

  // 4b. Idempotency-Key (H-11)
  await fastify.register(idempotencyPlugin);

  // 5. Rate limiter (per authenticated user)
  await fastify.register(rateLimiterPlugin, {
    redisUrl: config.redisUrl,
    maxPerMinute: config.rateLimitPerMinute,
  });

  // 6. Audit — onResponse hook
  await fastify.register(auditPlugin, { config, auditService });

  // ── Routes ────────────────────────────────────────────────────────────────────
  await fastify.register(healthRoutes, {
    config,
    postgresAuditSink: postgresAuditSink ?? undefined,
    redisStore: opts.redisStore,
  });

  await fastify.register(exportRoutes, {
    exportService: opts.exportService,
  });

  await fastify.register(connectorRoutes);

  await fastify.register(summaryRoutes, { config });

  await fastify.register(consentRoutes, { auditSink: resolvedAuditSink });

  await fastify.register(authRoutes, {
    auditService,
    hmacSecret: config.hmacSecret,
    jtiDenylist,
  });

  registerErrorHandler(fastify);

  // Graceful shutdown: dừng retention scheduler trước, rồi đóng sink (khi server tự tạo)
  if (retentionService) {
    const svc = retentionService;
    fastify.addHook('onClose', async () => {
      svc.stop();
    });
  }
  if (postgresAuditSink && !opts.auditSink) {
    const sink = postgresAuditSink;
    fastify.addHook('onClose', async () => {
      await sink.shutdown();
    });
  }

  return fastify;
}
