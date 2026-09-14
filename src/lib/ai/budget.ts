import 'server-only';

import { db } from '@/lib/db';

/**
 * What a student's AI use costs, and the ceiling on it.
 *
 * Measured on 2026-09-07 against the live models, reading the providers' own
 * usage counters rather than estimating from character counts:
 *
 *   one tutor question   two calls, ~16,000 in / 1,100 out          ~$0.083
 *   marking one answer   ~750 in / 200 out                       ~$0.010
 *   reading one photo    ~2,000 in / 1,200 out (downscaled)      ~$0.046
 *   the same photo at full phone resolution                      ~$0.110
 *
 * A tutor question is TWO calls, not one: the answer, then a second pass that
 * verifies it against the same retrieved material. The verification runs on a
 * cheaper model, which is why it is a third of the cost rather than half.
 *
 * A month of ordinary revision — thirty questions, sixty marked answers, ten
 * photos — is about three and a half dollars. That is what the ceilings below
 * are set against.
 */

/**
 * Dollars per million tokens, by model.
 *
 * Keyed on a prefix so a dated snapshot (`gpt-5.5-2026-04-23`) matches the entry
 * for its family without needing a row per release. Longest prefix wins, so a
 * specific version can still override its family.
 */
const PRICES: { prefix: string; input: number; cachedInput: number; output: number }[] = [
  { prefix: 'gpt-5.5', input: 5, cachedInput: 0.5, output: 30 },
  { prefix: 'gpt-5.4-pro', input: 30, cachedInput: 30, output: 180 },
  { prefix: 'gpt-5.4-mini', input: 0.75, cachedInput: 0.075, output: 4.5 },
  { prefix: 'gpt-5.4-nano', input: 0.2, cachedInput: 0.02, output: 1.25 },
  { prefix: 'gpt-5.4', input: 2.5, cachedInput: 0.25, output: 15 },
  { prefix: 'gpt-4.1', input: 2, cachedInput: 0.5, output: 8 },
  { prefix: 'claude-opus-5', input: 5, cachedInput: 0.5, output: 25 },
  { prefix: 'claude-sonnet-5', input: 2, cachedInput: 0.2, output: 10 },
  { prefix: 'text-embedding-3-small', input: 0.02, cachedInput: 0.02, output: 0 },
];

/**
 * An unknown model is charged at the highest rate on the list, not zero.
 *
 * Guessing low is the dangerous direction: a model nobody added a price for
 * would spend against a budget it never depletes, and the first anyone would
 * know is the invoice. Overcharging an unpriced model shows up as a student
 * hitting their ceiling early, which someone reports.
 */
const FALLBACK = PRICES.reduce((worst, row) => (row.output > worst.output ? row : worst), PRICES[0]!);

export function priceOf(model: string): { input: number; cachedInput: number; output: number } {
  const matches = PRICES.filter((row) => model.startsWith(row.prefix));
  if (matches.length === 0) return FALLBACK;
  return matches.reduce((best, row) => (row.prefix.length > best.prefix.length ? row : best));
}

/** Micro-dollars, so a month's total can be summed as an integer. */
export function costMicros(input: {
  model: string;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
}): bigint {
  const price = priceOf(input.model);
  const cached = input.cachedInputTokens ?? 0;
  const fresh = Math.max(0, input.inputTokens - cached);
  const dollars =
    (fresh * price.input + cached * price.cachedInput + input.outputTokens * price.output) / 1_000_000;
  return BigInt(Math.round(dollars * 1_000_000));
}

/**
 * The monthly ceiling for each plan, in micro-dollars.
 *
 * Set from the measured cost of a month's revision, not from a round number:
 * free is about a dozen tutor questions — enough to see whether the thing works
 * before paying — and a paid plan is roughly three times a typical month, so an
 * ordinary student never meets it and only genuinely heavy use does.
 *
 * Overridable per environment because these are a commercial decision, not an
 * engineering one, and they will change before the engineering does.
 */
const DEFAULT_BUDGET_MICROS: Record<string, bigint> = {
  free: 1_000_000n, // $1.00
  monthly: 10_000_000n, // $10.00
  annual: 10_000_000n, // $10.00
};

function envBudget(plan: string): bigint | null {
  const raw = process.env[`AI_BUDGET_${plan.toUpperCase()}_USD`];
  if (!raw) return null;
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return BigInt(Math.round(dollars * 1_000_000));
}

export function budgetMicrosFor(plan: string): bigint {
  return envBudget(plan) ?? DEFAULT_BUDGET_MICROS[plan] ?? DEFAULT_BUDGET_MICROS.free!;
}

/** First moment of the current month, which is when every ceiling resets. */
function startOfMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function spentThisMonthMicros(userId: string): Promise<bigint> {
  const rows = await db.aiUsage.aggregate({
    where: { userId, createdAt: { gte: startOfMonth() } },
    _sum: { costMicros: true },
  });
  return rows._sum.costMicros ?? 0n;
}

export type BudgetState = {
  spentMicros: bigint;
  budgetMicros: bigint;
  remainingMicros: bigint;
  exhausted: boolean;
};

/**
 * Where a student stands this month.
 *
 * Read before an expensive call rather than after it, so the request that would
 * cross the line is the one refused. A call already in flight is allowed to
 * finish and is recorded in full — refunding half an answer is not a thing, and
 * the overshoot is one request's worth.
 */
export async function budgetState(userId: string): Promise<BudgetState> {
  const [subscription, spentMicros] = await Promise.all([
    db.subscription.findUnique({ where: { userId }, select: { plan: true, aiBudgetMicros: true } }),
    spentThisMonthMicros(userId),
  ]);

  /*
   * A per-student ceiling wins over the plan's, and null is not zero.
   *
   * An administrator can give one account its own number — a scholarship, a
   * teacher trialling the product, a student who hit the limit mid-revision —
   * without a deployment and without moving everyone on that plan. Clearing it
   * is a return to the plan default, which is why the test is `!= null` rather
   * than truthiness: `0n` is a real ceiling an administrator may deliberately
   * set to stop an account spending, and `?? ` would keep it while `||` would
   * silently discard it back to the plan.
   */
  // No subscription row is the free plan, which is the state a new account is in.
  const override = subscription?.aiBudgetMicros;
  const budgetMicros =
    override != null ? BigInt(override) : budgetMicrosFor(String(subscription?.plan ?? 'free'));
  const remainingMicros = budgetMicros - spentMicros;

  return { spentMicros, budgetMicros, remainingMicros, exhausted: remainingMicros <= 0n };
}

/**
 * Records one call. Never throws.
 *
 * A failure to write the meter must not fail the student's request — they have
 * already been answered and the provider has already charged us. It is logged
 * loudly instead, because a silent meter is how a budget stops being one.
 */
export async function recordUsage(input: {
  userId: string | null;
  kind: string;
  model: string;
  inputTokens: number | null;
  cachedInputTokens?: number | null;
  outputTokens: number | null;
}): Promise<void> {
  try {
    const inputTokens = input.inputTokens ?? 0;
    const cachedInputTokens = input.cachedInputTokens ?? 0;
    const outputTokens = input.outputTokens ?? 0;

    await db.aiUsage.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        model: input.model,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        costMicros: costMicros({ model: input.model, inputTokens, cachedInputTokens, outputTokens }),
      },
    });
  } catch (err) {
    console.error('[budget] could not record usage', err);
  }
}
