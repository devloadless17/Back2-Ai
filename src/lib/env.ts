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

  /*
   * THREE MODELS, NOT TWO, because there are three jobs and the third was
   * borrowing the wrong one's name.
   *
   *   MODEL         writes the answer the student reads.
   *   MODEL_VERIFY  JUDGES: marks work, and checks an answer against its
   *                 sources. Correctness outranks cost here — it is the last
   *                 gate before a wrong answer reaches someone sitting a
   *                 national exam — so it is deliberately the strong model.
   *   MODEL_FAST    PLUMBING: translating a query, naming its topics,
   *                 reordering search hits. None of it is ever shown to a
   *                 student or quoted as a fact, and every one of those call
   *                 sites fails open, so the cheapest model that can do the job
   *                 is the right one.
   *
   * The plumbing used to run on MODEL_VERIFY, and `rerank.ts` still described
   * that as "the cheap verify model" — true of the OpenAI config, where VERIFY
   * is the mini model, and the exact opposite on the Anthropic config, where it
   * is Opus. One knob cannot mean both "cheapest available" and "strongest
   * available" depending on which provider is selected, and pointing at it from
   * the plumbing is how a query translation ends up costing Opus rates.
   *
   * FAST DEFAULTS TO WHAT THE PLUMBING ALREADY RAN ON under the live OpenAI
   * config, so this split changes no behaviour there — including the Arabic-only
   * reranking policy, which was measured against gpt-5.4-mini and must not be
   * silently re-decided by a config rename.
   */
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),
  ANTHROPIC_MODEL_VERIFY: z.string().default('claude-opus-5'),
  // Sonnet rather than Haiku only because `PRICES` in ai/budget.ts carries a
  // rate for Sonnet and not for Haiku, and an unpriced model is billed at the
  // table's worst rate. Add the Haiku row from the published price list and
  // this should move to it.
  ANTHROPIC_MODEL_FAST: z.string().default('claude-sonnet-5'),

  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().default('gpt-4.1'),
  OPENAI_MODEL_VERIFY: z.string().default('gpt-4.1'),
  OPENAI_MODEL_FAST: z.string().default('gpt-5.4-mini'),

  // 'local' runs a small multilingual model on the CPU: no key, no per-token
  // cost, slower. Its similarity scores sit in a different band from the hosted
  // providers, so RETRIEVAL_THRESHOLDS are selected per provider.
  EMBEDDING_PROVIDER: z.enum(['openai', 'voyage', 'local']).default('openai'),
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

  /*
   * Mail. Both optional on purpose: with no key, `sendEmail` logs the message
   * and reports success, so confirming an address or resetting a password works
   * end to end on a laptop with no mail account. A deployment that never sets
   * these still runs; it just never delivers.
   */
  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('Bac II <onboarding@resend.dev>'),

  /*
   * Web push. Generated with `npx web-push generate-vapid-keys`. The public key
   * reaches the browser, the private one never leaves the server. Absent, the
   * push endpoints refuse and the UI does not offer it — email reminders still
   * work, which is why this is not required.
   */
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:support@bac2.local'),
  // Only reached for signed-out pages whose visitor has no locale cookie and no
  // usable Accept-Language. Signed-in students always see their own locked
  // language, so changing this does not move anybody's account.
  DEFAULT_LOCALE: z.enum(['fr', 'en', 'ar']).default('en'),
  CRON_SECRET: z.string().default(''),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;

  /*
   * An empty variable means an unset one.
   *
   * A hosting dashboard has no way to express "absent" — you either delete the
   * row or leave the box blank, and most people leave it blank. Zod treats that
   * blank as a value, so `OCR_PROVIDER=""` fails an enum that would have been
   * perfectly happy with the variable missing, and its `.default()` never runs.
   *
   * That is not hypothetical: it failed a production build with
   * `OCR_PROVIDER: expected 'vision', received ''` and the same for
   * DEFAULT_LOCALE, both of which have defaults. Twenty-three variables here
   * carry a default and every one of them was one blank box away from the same
   * failure.
   *
   * Whitespace counts as empty too — a value that is one accidental space is
   * not a configuration choice anybody made.
   */
  const provided = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => (value ?? '').trim() !== ''),
  );

  const parsed = schema.safeParse(provided);
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
  // The local model needs no credential — it is always "configured", and a
  // failure to load it is a runtime error rather than a missing-key state.
  if (e.EMBEDDING_PROVIDER === 'local') return true;
  return e.EMBEDDING_PROVIDER === 'voyage' ? e.VOYAGE_API_KEY.length > 0 : e.OPENAI_API_KEY.length > 0;
}
