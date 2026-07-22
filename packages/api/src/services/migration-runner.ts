/**
 * Schema migration runner — đóng gap "init.sql chỉ chạy first-boot".
 *
 * Thiết kế tối giản (không thêm dependency):
 * - Bảng schema_migrations ghi version/name/checksum/applied_at
 * - File SQL đánh số `NNN_name.sql`, chạy tuần tự trong transaction, fail-fast
 * - Checksum SHA-256: file đã applied mà nội dung đổi → throw (drift detection)
 * - pg_advisory_lock: nhiều replica cùng boot/migrate không chạy đua
 *
 * QUYỀN: migrations chứa DDL — chạy bằng connection role admin (thường KHÔNG
 * phải role hạn chế fhirbridge_audit_writer mà API dùng lúc runtime). Vì vậy
 * runner được gọi qua CLI `migrate` (init-container / operator), không tự chạy
 * lúc API boot.
 *
 * INVARIANT: không migration nào được mutate audit rows lịch sử — giữ
 * immutability trigger (xem docs/operations/upgrading.md).
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Client tối thiểu mà runner cần — pg.PoolClient thỏa mãn. */
export interface MigrationClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
}

/** Pool tối thiểu mà runner cần — pg.Pool thỏa mãn. */
export interface MigrationPool {
  connect(): Promise<MigrationClient>;
}

export interface MigrationFile {
  /** Số thứ tự parse từ prefix tên file (NNN_name.sql) */
  version: number;
  name: string;
  sql: string;
}

export interface MigrationRunResult {
  /** Migrations vừa được apply trong lần chạy này (theo thứ tự) */
  applied: MigrationFile[];
  /** Số migration đã applied từ trước, bỏ qua */
  skipped: number;
}

/** Advisory lock key riêng cho FHIRBridge migrations (số bất kỳ, cố định). */
const MIGRATION_LOCK_KEY = 727_856_193;

/** SHA-256 hex của nội dung migration — dùng phát hiện drift. */
export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/**
 * Đọc thư mục migrations: file `NNN_name.sql`, sort theo version tăng dần.
 * Throw khi version trùng hoặc tên file sai format (fail-fast, không bỏ sót).
 */
export function loadMigrationsFromDir(dir: string): MigrationFile[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  const migrations: MigrationFile[] = [];

  for (const file of files) {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) {
      throw new Error(`Migration file "${file}" phải theo format NNN_name.sql`);
    }
    migrations.push({
      version: parseInt(match[1]!, 10),
      name: match[2]!,
      sql: readFileSync(join(dir, file), 'utf8'),
    });
  }

  migrations.sort((a, b) => a.version - b.version);

  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i]!.version === migrations[i - 1]!.version) {
      throw new Error(`Trùng migration version ${migrations[i]!.version}`);
    }
  }

  return migrations;
}

/**
 * Chạy các migration chưa applied, tuần tự theo version, mỗi migration một
 * transaction. Idempotent: chạy lại là no-op khi mọi version đã ghi nhận.
 */
export async function runMigrations(
  pool: MigrationPool,
  migrations: MigrationFile[],
): Promise<MigrationRunResult> {
  const client = await pool.connect();
  const applied: MigrationFile[] = [];
  let skipped = 0;

  try {
    // Serialize giữa các replica — chờ tới lượt thay vì fail
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER      PRIMARY KEY,
        name       TEXT         NOT NULL,
        checksum   CHAR(64)     NOT NULL,
        applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    const { rows } = await client.query('SELECT version, checksum FROM schema_migrations');
    const appliedMap = new Map<number, string>(
      rows.map((r) => [Number(r['version']), String(r['checksum'])]),
    );

    for (const migration of migrations) {
      const existing = appliedMap.get(migration.version);
      const checksum = checksumOf(migration.sql);

      if (existing !== undefined) {
        // Drift detection: file đã applied nhưng nội dung trên đĩa đã đổi
        if (existing.trim() !== checksum) {
          throw new Error(
            `Migration ${migration.version}_${migration.name} đã applied nhưng checksum khác — ` +
              'không được sửa migration cũ, hãy tạo migration mới',
          );
        }
        skipped++;
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, checksum],
        );
        await client.query('COMMIT');
        applied.push(migration);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration ${migration.version}_${migration.name} failed: ${(err as Error).message}`,
        );
      }
    }

    return { applied, skipped };
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    } catch {
      // Connection có thể đã chết — release là đủ
    }
    client.release();
  }
}
