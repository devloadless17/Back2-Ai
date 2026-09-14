/**
 * Provider-neutral AI surface.
 *
 * Both implementations are real API clients — `anthropic.ts` (Claude) and
 * `openai.ts` (GPT) — selected by the AI_PROVIDER env var so either can be
 * evaluated against the same prompts without touching call sites.
 *
 * Every consumer in this codebase (chat, generation, grading, verification,
 * OCR) goes through this interface. Nothing imports a vendor SDK directly.
 */

export type AiRole = 'user' | 'assistant';

export type AiMessage = {
  role: AiRole;
  content: string;
};

/** A base64-encoded image handed to a multimodal model (OCR, photo answers). */
export type AiImage = {
  /** Raw base64, no `data:` prefix. */
  base64: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
};

/**
 * Reasoning depth. Mapped per provider — on Claude this drives
 * `output_config.effort`; on OpenAI it maps to that provider's nearest
 * equivalent. `high` is the default because this system marks real exams.
 */
export type AiEffort = 'low' | 'medium' | 'high';

export type AiRequest = {
  system?: string;
  messages: AiMessage[];
  images?: AiImage[];
  maxTokens?: number;
  effort?: AiEffort;
  /** Overrides the provider's default model — used to route grading to the verify model. */
  model?: string;
  /**
   * Who is spending, and on what.
   *
   * Carried on the request rather than recorded at each call site, because a
   * call site that forgets leaves a hole in the meter that nothing reveals
   * until the invoice. Null for work that belongs to no student — a corpus
   * script, a cron job — which is metered but not charged to anyone.
   */
  meter?: { userId: string | null; kind: string };
};

export type AiResponse = {
  text: string;
  modelUsed: string;
  inputTokens: number | null;
  /**
   * How many of `inputTokens` the provider served from its prompt cache.
   *
   * ALWAYS A SUBSET OF `inputTokens`, never additional to it, because that is
   * what `costMicros` assumes when it splits the bill. The two providers report
   * it differently and each adapter is responsible for normalising to this rule:
   * OpenAI's `prompt_tokens` already includes the cached part, Anthropic's
   * `input_tokens` excludes it and has to have it added back.
   *
   * Both providers discount these tokens by an order of magnitude. Left unread,
   * every call is billed as if nothing were cached, and the student's AI budget
   * drains faster than the invoice it is supposed to track.
   */
  cachedInputTokens: number | null;
  outputTokens: number | null;
  /**
   * True when the provider's safety layer declined the request. Callers must
   * treat this as a content outcome, not an exception: a refused grading pass
   * is a paper that needs human marking, not a 500.
   */
  refused: boolean;
};

export type AiJsonRequest<T> = AiRequest & {
  /** JSON Schema the response is constrained to. Must set additionalProperties: false. */
  schema: Record<string, unknown>;
  /** Short identifier for the schema; some providers require it. */
  schemaName: string;
  /** Validates and narrows the parsed payload. Throws on mismatch. */
  parse: (value: unknown) => T;
};

export type AiJsonResponse<T> = {
  data: T;
  modelUsed: string;
  inputTokens: number | null;
  /** Subset of `inputTokens` served from the prompt cache. See `AiResponse`. */
  cachedInputTokens: number | null;
  outputTokens: number | null;
};

export interface AiProvider {
  readonly name: 'anthropic' | 'openai';
  /** Writes what the student reads. */
  readonly defaultModel: string;
  /** Judges: marks work, checks an answer against its sources. The strong one. */
  readonly verifyModel: string;
  /**
   * Plumbing: query translation, topic keywords, reranking search hits.
   *
   * Never shown to a student and never quoted as a fact, and every call site
   * that uses it fails open — so the cheapest adequate model belongs here, and
   * NOT `verifyModel`, which is chosen for correctness at the last gate before
   * a wrong answer reaches someone sitting an exam. See `env.ts`.
   */
  readonly fastModel: string;

  /** Whether a usable API key is present. Callers render a configuration notice when false. */
  isConfigured(): boolean;

  complete(request: AiRequest): Promise<AiResponse>;

  /**
   * Constrained JSON output. Used everywhere a downstream consumer needs
   * structure it can act on — barème marking, generated problems, schedules.
   */
  completeJson<T>(request: AiJsonRequest<T>): Promise<AiJsonResponse<T>>;

  /**
   * Token-by-token text. Chat streams so a student never watches a blank box
   * while a multi-step derivation is produced.
   */
  streamText(request: AiRequest): AsyncGenerator<string, AiResponse, undefined>;
}

/** Thrown when an AI call fails for an operational reason (no key, network, provider error). */
export class AiError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export class AiNotConfiguredError extends AiError {
  constructor(provider: string) {
    super(`The ${provider} provider has no API key configured.`);
    this.name = 'AiNotConfiguredError';
  }
}
