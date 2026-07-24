/**
 * Configuration loader for the FHIRBridge API server.
 * Validates all required environment variables at startup via Zod schema.
 * Fails fast with descriptive errors on misconfiguration.
 */

import { z } from 'zod';

/** Typed API server configuration — inferred from Zod schema */
export type ApiConfig = z.infer<typeof ApiConfigSchema>;

// ── Zod schema ────────────────────────────────────────────────────────────────

const ApiConfigSchema = z
  .object({
    port: z.coerce.number().int().min(1).max(65535).default(3001),

    host: z.string().default('0.0.0.0'),

    jwtSecret: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

    hmacSecret: z.string().min(32, 'HMAC_SECRET must be at least 32 characters'),

    apiKeys: z
      .string()
      .default('')
      .transform((raw) =>
        raw
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      ),

    corsOrigins: z
      .string()
      .default('http://localhost:3000')
      .transform((raw) =>
        raw
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),

    databaseUrl: z.string().url('DATABASE_URL must be a valid URL').optional(),

    redisUrl: z.string().url('REDIS_URL must be a valid URL').optional(),

    logLevel: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

    trustProxy: z
      .string()
      .optional()
      .transform((val) => {
        if (!val || val === 'false') return false;
        if (val === 'true') return true;
        return val; // CIDR string like '10.0.0.0/8'
      }),

    metricsBearerToken: z.string().min(16).optional(),

    // Per-user rate-limit budget (was read ad-hoc from process.env — now validated so typos fail fast).
    rateLimitPerMinute: z.coerce.number().int().positive().default(100),

    // Swagger/OpenAPI docs toggle. Accepts true/1 → on; anything else → off. Default on.
    enableDocs: z
      .string()
      .optional()
      .transform((val) => (val === undefined ? true : val === 'true' || val === '1')),

    // Optional AI provider credentials + selection (summary endpoints).
    anthropicApiKey: z.string().optional(),
    openaiApiKey: z.string().optional(),
    aiProvider: z.enum(['anthropic', 'openai']).optional(),

    // Optional override for structured-error docs deep links.
    errorDocsBaseUrl: z.string().url('ERROR_DOCS_BASE_URL must be a valid URL').optional(),

    // Audit retention window (days) — OPT-IN, không có default. Khi set, API tự
    // chạy purge_audit_logs() mỗi 24h (cần migration 002 cho role least-privilege).
    // Không set = không tự xoá (schedule pg_cron thủ công nếu muốn). Không default
    // vì auto-purge ngầm có thể xoá audit data pháp luật yêu cầu giữ (KR ≥ 730 ngày).
    auditRetentionDays: z.coerce.number().int().positive().optional(),

    // KR 개인정보 안전성 확보조치 (access log 접속기록): 'kr' bật thêm
    // patientRefHash + sourceIp trong audit metadata. Mặc định (undefined) giữ
    // nguyên hành vi hiện tại — IP là personal data dưới GDPR nên chỉ bật theo profile.
    auditProfile: z.enum(['default', 'kr']).optional(),
  })
  .superRefine((data, ctx) => {
    // HMAC_SECRET must differ from JWT_SECRET to prevent key reuse
    if (data.hmacSecret === data.jwtSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hmacSecret'],
        message: 'HMAC_SECRET must be different from JWT_SECRET (key reuse is a security risk)',
      });
    }

    const isProduction = process.env['NODE_ENV'] === 'production';

    for (const field of ['jwtSecret', 'hmacSecret'] as const) {
      const value = data[field];

      // Placeholder secrets are NEVER acceptable — a copy-pasted .env.example must fail fast.
      if (isPlaceholderSecret(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} looks like a placeholder — set a real, unique secret`,
        });
        continue;
      }

      // Low-entropy secrets (e.g. "aaaa…", padded repeats) only rejected in production.
      if (isProduction && isLowEntropySecret(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} has insufficient entropy for production — use a random ≥32-char secret`,
        });
      }
    }
  });

/** Known placeholder markers that must never ship as real secrets. */
const PLACEHOLDER_MARKERS = [
  'change-this',
  'changeme',
  'change-me',
  'your-secret',
  'your_secret',
  'placeholder',
  'example',
  'secret-here',
] as const;

/** True when the secret contains any known placeholder marker (case-insensitive). */
function isPlaceholderSecret(secret: string): boolean {
  const lower = secret.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Heuristic low-entropy check: too few distinct characters for the length signals a padded or
 * repeated secret (e.g. "aaaa…"). A random 32-char secret has well over a dozen distinct chars.
 */
function isLowEntropySecret(secret: string): boolean {
  const distinct = new Set(secret).size;
  return distinct < 8;
}

/** Load and validate configuration from environment variables. Throws on failure. */
export function loadConfig(): ApiConfig {
  const raw = {
    port: process.env['PORT'],
    host: process.env['HOST'],
    jwtSecret: process.env['JWT_SECRET'],
    hmacSecret: process.env['HMAC_SECRET'] ?? process.env['JWT_SECRET'],
    apiKeys: process.env['API_KEYS'],
    corsOrigins: process.env['CORS_ORIGINS'],
    databaseUrl: process.env['DATABASE_URL'],
    redisUrl: process.env['REDIS_URL'],
    logLevel: process.env['LOG_LEVEL'],
    trustProxy: process.env['TRUST_PROXY'],
    metricsBearerToken: process.env['METRICS_BEARER_TOKEN'],
    rateLimitPerMinute: process.env['RATE_LIMIT_PER_MINUTE'],
    enableDocs: process.env['ENABLE_DOCS'],
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
    openaiApiKey: process.env['OPENAI_API_KEY'],
    aiProvider: process.env['AI_PROVIDER'],
    errorDocsBaseUrl: process.env['ERROR_DOCS_BASE_URL'],
    auditRetentionDays: process.env['AUDIT_RETENTION_DAYS'],
    auditProfile: process.env['AUDIT_PROFILE'],
  };

  const result = ApiConfigSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`FHIRBridge configuration error:\n${messages}`);
  }

  return result.data;
}
