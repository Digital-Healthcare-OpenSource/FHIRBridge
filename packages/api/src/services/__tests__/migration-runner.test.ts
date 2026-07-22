/**
 * Migration runner tests — fake pool, không cần Postgres thật.
 * Cover: apply theo thứ tự, skip đã applied, checksum drift, rollback on error,
 * advisory lock/unlock, loader format + trùng version, baseline sync init.sql.
 */

import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  runMigrations,
  loadMigrationsFromDir,
  checksumOf,
  type MigrationClient,
  type MigrationPool,
  type MigrationFile,
} from '../migration-runner.js';

/** Fake client ghi lại mọi câu SQL; trả applied rows cấu hình được. */
function buildFakePool(opts?: {
  appliedRows?: Array<{ version: number; checksum: string }>;
  failOnSql?: RegExp;
}) {
  const executed: string[] = [];
  let released = false;

  const client: MigrationClient = {
    query: async (sql: string) => {
      executed.push(sql.trim());
      if (opts?.failOnSql?.test(sql)) {
        throw new Error('boom');
      }
      if (sql.includes('SELECT version, checksum')) {
        return { rows: (opts?.appliedRows ?? []) as unknown as Array<Record<string, unknown>> };
      }
      return { rows: [] };
    },
    release: () => {
      released = true;
    },
  };

  const pool: MigrationPool = { connect: async () => client };
  return { pool, executed, isReleased: () => released };
}

const M1: MigrationFile = { version: 1, name: 'baseline', sql: 'CREATE TABLE a (id int)' };
const M2: MigrationFile = { version: 2, name: 'add_b', sql: 'CREATE TABLE b (id int)' };

describe('runMigrations', () => {
  it('applies pending migrations theo thứ tự version, ghi schema_migrations', async () => {
    const { pool, executed, isReleased } = buildFakePool();
    const result = await runMigrations(pool, [M1, M2]);

    expect(result.applied.map((m) => m.version)).toEqual([1, 2]);
    expect(result.skipped).toBe(0);

    const joined = executed.join('\n');
    expect(joined).toContain('pg_advisory_lock');
    expect(joined).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
    // M1 chạy trước M2
    expect(joined.indexOf('CREATE TABLE a')).toBeLessThan(joined.indexOf('CREATE TABLE b'));
    // Mỗi migration nằm trong BEGIN/COMMIT
    expect(executed.filter((s) => s === 'BEGIN')).toHaveLength(2);
    expect(executed.filter((s) => s === 'COMMIT')).toHaveLength(2);
    expect(joined).toContain('pg_advisory_unlock');
    expect(isReleased()).toBe(true);
  });

  it('skips migrations đã applied (idempotent re-run)', async () => {
    const { pool, executed } = buildFakePool({
      appliedRows: [{ version: 1, checksum: checksumOf(M1.sql) }],
    });
    const result = await runMigrations(pool, [M1, M2]);

    expect(result.skipped).toBe(1);
    expect(result.applied.map((m) => m.version)).toEqual([2]);
    expect(executed.join('\n')).not.toContain('CREATE TABLE a');
  });

  it('throws khi checksum drift (migration đã applied bị sửa nội dung)', async () => {
    const { pool } = buildFakePool({
      appliedRows: [{ version: 1, checksum: checksumOf('OLD CONTENT') }],
    });
    await expect(runMigrations(pool, [M1])).rejects.toThrow(/checksum khác/);
  });

  it('ROLLBACK + throw khi migration SQL fail; migration sau không chạy', async () => {
    const { pool, executed, isReleased } = buildFakePool({ failOnSql: /CREATE TABLE a/ });

    await expect(runMigrations(pool, [M1, M2])).rejects.toThrow(/1_baseline failed/);
    expect(executed).toContain('ROLLBACK');
    expect(executed.join('\n')).not.toContain('CREATE TABLE b');
    // Lock được nhả và client được release kể cả khi fail
    expect(executed.join('\n')).toContain('pg_advisory_unlock');
    expect(isReleased()).toBe(true);
  });
});

describe('loadMigrationsFromDir', () => {
  it('đọc file NNN_name.sql, sort theo version; reject tên sai format + version trùng', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhirbridge-mig-'));
    try {
      writeFileSync(join(dir, '002_second.sql'), 'B');
      writeFileSync(join(dir, '001_first.sql'), 'A');

      const migrations = loadMigrationsFromDir(dir);
      expect(migrations.map((m) => `${m.version}_${m.name}`)).toEqual(['1_first', '2_second']);
      expect(migrations[0]!.sql).toBe('A');

      writeFileSync(join(dir, 'not-numbered.sql'), 'X');
      expect(() => loadMigrationsFromDir(dir)).toThrow(/NNN_name\.sql/);

      rmSync(join(dir, 'not-numbered.sql'));
      writeFileSync(join(dir, '001_duplicate.sql'), 'C');
      expect(() => loadMigrationsFromDir(dir)).toThrow(/Trùng migration version 1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('baseline 001 của package khớp checksum với docker/postgres/init.sql (không drift)', () => {
    // Nếu init.sql đổi mà 001_baseline.sql không đổi (hoặc ngược lại) → test đỏ,
    // buộc giữ 2 đường khởi tạo schema (first-boot vs migrate) đồng bộ.
    const testDir = fileURLToPath(new URL('.', import.meta.url));
    const baseline = loadMigrationsFromDir(join(testDir, '../../../migrations')).find(
      (m) => m.version === 1,
    );
    const initSql = readFileSync(join(testDir, '../../../../../docker/postgres/init.sql'), 'utf8');
    expect(baseline).toBeDefined();
    expect(checksumOf(baseline!.sql)).toBe(checksumOf(initSql));
  });
});
