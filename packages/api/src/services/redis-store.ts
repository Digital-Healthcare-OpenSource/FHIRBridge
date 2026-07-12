/**
 * Redis-backed generic store with in-memory fallback.
 * Used by ExportService and SummaryService to replace module-level Maps.
 * PRIVACY: callers must ensure keys contain no PHI (use hashed IDs only).
 */

import Redis from 'ioredis';

export interface RedisStoreOptions {
  url: string;
  /** Key namespace prefix, e.g. "export:" */
  keyPrefix?: string;
}

/** Generic key-value store interface */
export interface IRedisStore {
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  get<T = unknown>(key: string): Promise<T | undefined>;
  delete(key: string): Promise<void>;
  isHealthy(): boolean;
}

/** Wraps ioredis with JSON serialization and graceful in-memory fallback */
export class RedisStore implements IRedisStore {
  private client: Redis | null = null;
  private healthy = false;
  private readonly prefix: string;
  private readonly fallback = new Map<string, { value: string; expiresAt: number }>();

  constructor(options: RedisStoreOptions) {
    this.prefix = options.keyPrefix ?? '';
    try {
      this.client = new Redis(options.url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
      });

      this.client.on('ready', () => {
        this.healthy = true;
      });
      this.client.on('error', (err: Error) => {
        if (this.healthy) {
          console.error('[RedisStore] connection error, falling back to in-memory:', err.message);
        }
        this.healthy = false;
      });
      this.client.on('close', () => {
        this.healthy = false;
      });

      // Trigger connection (non-blocking)
      this.client.connect().catch((err: Error) => {
        console.error(
          '[RedisStore] initial connect failed, using in-memory fallback:',
          err.message,
        );
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[RedisStore] failed to create client, using in-memory fallback:', msg);
      this.client = null;
    }
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const fullKey = this.prefix + key;
    const serialized = JSON.stringify(value);

    if (this.healthy && this.client) {
      try {
        await this.client.set(fullKey, serialized, 'EX', ttlSeconds);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[RedisStore] set failed, falling back to in-memory:', msg);
      }
    }

    // In-memory fallback with TTL.
    // Sweep expired entries on set để fallback Map không phình vô hạn khi Redis down
    // kéo dài (trước đây chỉ evict lazy khi get đúng key hết hạn).
    this.sweepExpiredFallback();
    this.fallback.set(fullKey, {
      value: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  /** Evict expired entries khỏi in-memory fallback Map. */
  private sweepExpiredFallback(): void {
    const now = Date.now();
    for (const [key, entry] of this.fallback.entries()) {
      if (now > entry.expiresAt) this.fallback.delete(key);
    }
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const fullKey = this.prefix + key;

    if (this.healthy && this.client) {
      try {
        const raw = await this.client.get(fullKey);
        if (raw === null) return undefined;
        return JSON.parse(raw) as T;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[RedisStore] get failed, trying in-memory fallback:', msg);
      }
    }

    // In-memory fallback
    const entry = this.fallback.get(fullKey);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.fallback.delete(fullKey);
      return undefined;
    }
    return JSON.parse(entry.value) as T;
  }

  async delete(key: string): Promise<void> {
    const fullKey = this.prefix + key;
    this.fallback.delete(fullKey);

    if (this.healthy && this.client) {
      try {
        await this.client.del(fullKey);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[RedisStore] delete failed:', msg);
      }
    }
  }

  /** Graceful shutdown — close Redis connection */
  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
    }
  }
}
