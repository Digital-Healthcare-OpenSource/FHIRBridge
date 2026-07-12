/**
 * @fhirbridge/api entry point.
 * Loads config via Zod, wires sinks/stores/services, tạo Fastify server,
 * và bắt đầu listen. Xử lý graceful shutdown khi SIGTERM/SIGINT.
 *
 * Self-host edition: no billing / quota / outbound webhooks.
 *
 * Bootstrap order:
 *   1. Config validation (Zod — fail fast)
 *   2. Stores: RedisStore (optional, in-memory fallback)
 *   3. Sinks: AuditSink (Postgres nếu có DATABASE_URL, else Console)
 *   4. Services: ExportService, SummaryService
 *   5. Server: createServer với services đã wire
 *   6. Graceful shutdown hooks
 */

import 'dotenv/config';
import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { RedisStore } from './services/redis-store.js';
import { PostgresAuditSink } from './services/postgres-audit-sink.js';
import { AuditService, ConsoleAuditSink } from './services/audit-service.js';
import { ExportService } from './services/export-service.js';
import { SummaryService } from './services/summary-service.js';

export { createServer } from './server.js';
export { loadConfig } from './config.js';
export type { ApiConfig } from './config.js';
export type { ServerOpts } from './server.js';

/** Start the server and bind to configured host/port */
export async function startServer(): Promise<void> {
  // ── 1. Config — Zod validation, throw ngay nếu sai ──────────────────────────
  const config = loadConfig();

  // ── 2. Stores ─────────────────────────────────────────────────────────────────
  // RedisStore owns its own ioredis client (with in-memory fallback) — no separate bootstrap
  // client needed. This one is closed in shutdown().
  const redisStore = config.redisUrl
    ? new RedisStore({ url: config.redisUrl, keyPrefix: 'fhirbridge:' })
    : null;

  // ── 3. Audit sink ─────────────────────────────────────────────────────────────
  const auditSink = config.databaseUrl
    ? new PostgresAuditSink(config.databaseUrl)
    : new ConsoleAuditSink();

  const auditService = new AuditService(auditSink);

  // ── 4. Services ───────────────────────────────────────────────────────────────
  const exportService = new ExportService({
    redis: redisStore ?? undefined,
  });

  const summaryService = new SummaryService(
    redisStore ?? undefined,
    auditService,
    config.hmacSecret,
  );

  // ── 5. Server ─────────────────────────────────────────────────────────────────
  const server = await createServer({
    config,
    auditSink,
    redisStore: redisStore ?? undefined,
    exportService,
    summaryService,
  });

  // ── 6. Graceful shutdown ──────────────────────────────────────────────────────
  // Race the drain against a hard timeout so an in-flight stream can't hang the process past the
  // orchestrator's SIGKILL window; re-entrancy guarded so a second signal doesn't double-close.
  const SHUTDOWN_TIMEOUT_MS = 25_000;
  let isShuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    server.log.info(`Received ${signal}, shutting down gracefully...`);

    const forceExit = setTimeout(() => {
      server.log.error(`Shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms — forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await server.close();

      if (auditSink instanceof PostgresAuditSink) {
        await auditSink.shutdown();
      }

      // Close the real RedisStore client (previously an unused bootstrap client was closed instead).
      if (redisStore) {
        await redisStore.close();
      }

      clearTimeout(forceExit);
      server.log.info('Server closed');
      process.exit(0);
    } catch (err) {
      clearTimeout(forceExit);
      server.log.error(err, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await server.listen({ port: config.port, host: config.host });
    server.log.info(`FHIRBridge API listening on ${config.host}:${config.port}`);
  } catch (err) {
    server.log.error(err, 'Failed to start server');
    process.exit(1);
  }
}

// Auto-start when executed directly
if (process.argv[1]?.endsWith('index.js')) {
  void startServer();
}
