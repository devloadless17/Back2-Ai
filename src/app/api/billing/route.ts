import { z } from 'zod';

import { assertSameOrigin, ok, parseBody, route, unauthorized } from '@/lib/api';
import { AuditAction, recordAudit } from '@/lib/audit';
import { apiUser } from '@/lib/auth/guards';
import { CARD_BRANDS, PLAN_IDS, PLANS } from '@/lib/billing';
import { db } from '@/lib/db';

/**
 * The student's own billing row.
 *
 * No processor is connected, so this handler does exactly two things: it records
 * which plan was chosen, and it records the non-secret description of a card.
 * It never authorises, charges, or grants an entitlement — status stays
 * `pending` until something outside this codebase says otherwise, and nothing in
 * the product reads it as permission.
 *
 * When a processor is added, the card fields here become the echo of what it
 * returns, and this handler gains a call to it. The shape does not change.
 */

const cardSchema = z
  .object({
    brand: z.enum(CARD_BRANDS),
    last4: z.string().regex(/^\d{4}$/),
    expMonth: z.number().int().min(1).max(12),
    expYear: z.number().int().min(2000).max(2100),
    cardholderName: z.string().trim().min(1).max(120),
  })
  .strict();

const bodySchema = z.object({
  plan: z.enum(PLAN_IDS),
  /** Absent leaves any stored card untouched; null removes it. */
  card: cardSchema.nullish(),
});

export const GET = route(async () => {
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const subscription = await db.subscription.findUnique({
    where: { userId: auth.user.id },
    select: {
      plan: true,
      status: true,
      cardBrand: true,
      cardLast4: true,
      cardExpMonth: true,
      cardExpYear: true,
      cardholderName: true,
      currentPeriodEnd: true,
    },
  });

  return ok({ subscription });
});

export const PUT = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const body = await parseBody(request, bodySchema);

  const existing = await db.subscription.findUnique({
    where: { userId: user.id },
    select: { plan: true, cardLast4: true },
  });

  // Choosing a paid plan with no card — neither sent now nor already stored —
  // records the free plan instead. See the same rule at signup.
  const hasCard = body.card ? true : body.card === null ? false : Boolean(existing?.cardLast4);
  const plan = PLANS[body.plan].requiresCard && !hasCard ? 'free' : body.plan;

  const card =
    body.card === undefined
      ? {}
      : body.card === null
        ? {
            cardBrand: null,
            cardLast4: null,
            cardExpMonth: null,
            cardExpYear: null,
            cardholderName: null,
          }
        : {
            cardBrand: body.card.brand,
            cardLast4: body.card.last4,
            cardExpMonth: body.card.expMonth,
            cardExpYear: body.card.expYear,
            cardholderName: body.card.cardholderName,
          };

  const subscription = await db.subscription.upsert({
    where: { userId: user.id },
    create: { userId: user.id, plan, status: 'pending', ...card },
    update: { plan, ...card },
    select: {
      plan: true,
      status: true,
      cardBrand: true,
      cardLast4: true,
      cardExpMonth: true,
      cardExpYear: true,
      cardholderName: true,
      currentPeriodEnd: true,
    },
  });

  if (existing?.plan !== plan) {
    await recordAudit({
      actorUserId: user.id,
      action: AuditAction.BILLING_PLAN_CHANGED,
      targetType: 'user',
      targetId: user.id,
      metadata: { from: existing?.plan ?? null, to: plan },
    });
  }

  if (body.card !== undefined) {
    await recordAudit({
      actorUserId: user.id,
      action: body.card === null ? AuditAction.BILLING_CARD_REMOVED : AuditAction.BILLING_CARD_SAVED,
      targetType: 'user',
      targetId: user.id,
      // Last four only. An audit trail that quotes a card number is a breach
      // waiting to be exported.
      metadata: body.card === null ? {} : { brand: body.card.brand, last4: body.card.last4 },
    });
  }

  return ok({ subscription });
});
