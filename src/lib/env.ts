import { z } from 'zod';

/**
 * Server-side environment. Parsed lazily and cached, so that importing a module
 * that touches config does not blow up at build time when env is not present.
 *
 * Anything read here is server-only. Never import this from a client component.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),

  AI_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),

  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),
  ANTHROPIC_MODEL_VERIFY: z.string().default('claude-opus-5'),

  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().default('gpt-4.1'),
  OPENAI_MODEL_VERIFY: z.string().default('gpt-4.1'),

  EMBEDDING_PROVIDER: z.enum(['openai', 'voyage']).default('openai'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1536),
  VOYAGE_API_KEY: z.string().default(''),

  OCR_PROVIDER: z.enum(['vision']).default('vision'),

  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('bac2'),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: booleanish.default(true),

  APP_URL: z.string().default('http://localhost:3000'),
  DEFAULT_LOCALE: z.enum(['fr', 'en', 'ar']).default('fr'),
  CRON_SECRET: z.string().default(''),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
  }

  cached = parsed.data;
  return cached;
}

/**
 * Whether the configured AI provider actually has a usable key. The app is
 * fully navigable without one — AI surfaces render an explicit "not configured"
 * state instead of throwing, so an unkeyed deployment is still inspectable.
 */
export function isAiConfigured(): boolean {
  const e = env();
  return e.AI_PROVIDER === 'anthropic' ? e.ANTHROPIC_API_KEY.length > 0 : e.OPENAI_API_KEY.length > 0;
}

export function isEmbeddingConfigured(): boolean {
  const e = env();
  return e.EMBEDDING_PROVIDER === 'voyage' ? e.VOYAGE_API_KEY.length > 0 : e.OPENAI_API_KEY.length > 0;
}
