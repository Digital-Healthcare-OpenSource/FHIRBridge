/**
 * CLI entry — chạy schema migrations: `pnpm --filter @fhirbridge/api migrate`.
 *
 * Cần DATABASE_URL trỏ tới role có quyền DDL (KHÔNG phải role runtime hạn chế
 * fhirbridge_audit_writer). Dùng như init-container trước khi API start, hoặc
 * operator chạy tay khi nâng cấp — xem docs/operations/upgrading.md.
 *
 * Exit 0 khi mọi migration applied/skipped; exit 1 khi fail (fail-fast).
 */

import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { loadMigrationsFromDir, runMigrations } from './services/migration-runner.js';

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('migrate: DATABASE_URL is required (admin/DDL-capable role)');
    process.exit(1);
  }

  // dist/migrate.js → ../migrations = packages/api/migrations (ship kèm package)
  const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));
  const migrations = loadMigrationsFromDir(migrationsDir);

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await runMigrations(pool, migrations);
    for (const m of result.applied) {
      console.log(`applied  ${m.version}_${m.name}`);
    }
    console.log(`migrate: ${result.applied.length} applied, ${result.skipped} already up-to-date`);
  } finally {
    await pool.end();
  }
}

main().catch((err: Error) => {
  console.error(`migrate: FAILED — ${err.message}`);
  process.exit(1);
});
