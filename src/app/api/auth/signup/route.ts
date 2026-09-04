import { z } from 'zod';

import {
  assertSameOrigin,
  clientKey,
  created,
  fail,
  parseBody,
  rateLimit,
  route,
  tooManyRequests,
} from '@/lib/api';
import { AuditAction, recordAudit } from '@/lib/audit';
import { hashPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { issueToken } from '@/lib/auth/tokens';
import { appLink, sendEmail } from '@/lib/email';
import { CARD_BRANDS, PLAN_IDS, PLANS } from '@/lib/billing';
import { AVAILABLE_COUNTRIES, DEFAULT_COUNTRY } from '@/lib/countries';
import { db } from '@/lib/db';
import { LOCALES } from '@/lib/i18n/config';

/**
 * Minimum password length.
 *
 * Length rather than a composition rule: forcing a symbol and a digit produces
 * `Password1!` and nothing else. NIST guidance has recommended length-first for
 * years, and these are teenagers who will otherwise write it on the desk.
 */
const MIN_PASSWORD_LENGTH = 10;

/**
 * What may be said about a card.
 *
 * There is no field here for the card number or the security code, and that is
 * the point: the schema is the enforcement. A client that posts them is
 * rejected by `parseBody` rather than quietly having them dropped, so the
 * mistake surfaces in development instead of in a database dump.
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
  email: z.string().trim().email().max(320),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(400),
  displayName: z.string().trim().min(1).max(120),
  trackId: z.string().uuid(),
  preferredLanguage: z.enum(LOCALES),
  // Optional-with-a-fallback rather than a zod default: `parseBody` is typed so
  // that a schema's input and output match, and a default would make the parsed
  // field optional at the type level while claiming otherwise.
  country: z.string().trim().toUpperCase().length(2).optional(),
  plan: z.enum(PLAN_IDS).optional(),
  card: cardSchema.optional(),
});

/**
 * Create a student account.
 *
 * Track and language are captured here and then locked — changing either is an
 * admin-only, audit-logged action. That is a deliberate product decision: a
 * student who switches track mid-year invalidates their entire mastery history,
 * so it should require a human to look at the case.
 */
export const POST = route(async (request) => {
  assertSameOrigin(request);

  const limit = rateLimit(clientKey(request, 'signup'), 5, 60 * 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const body = await parseBody(request, bodySchema);
  const email = body.email.toLowerCase();

  const track = await db.track.findUnique({ where: { id: body.trackId }, select: { id: true } });
  if (!track) return fail(422, 'UNKNOWN_TRACK');

  // A country with no ingested curriculum would produce an account with nothing
  // to study, so it is refused here rather than left to the UI's disabled
  // attribute — which is a hint to a browser, not a rule.
  const country = body.country ?? DEFAULT_COUNTRY;
  if (!(AVAILABLE_COUNTRIES as readonly string[]).includes(country)) {
    return fail(422, 'COUNTRY_UNAVAILABLE');
  }

  // A paid plan without a card is a free account, not a debt. Nothing charges
  // yet either way; this keeps the row honest about what was actually agreed.
  const requestedPlan = body.plan ?? 'free';
  const plan = PLANS[requestedPlan].requiresCard && !body.card ? 'free' : requestedPlan;

  const existing = await db.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) return fail(409, 'EMAIL_TAKEN');

  const passwordHash = await hashPassword(body.password);

  let user;
  try {
    user = await db.user.create({
      data: {
        email,
        passwordHash,
        displayName: body.displayName,
        trackId: track.id,
        preferredLanguage: body.preferredLanguage,
        country,
        role: 'student',
        // Written in the same transaction as the user: every account has a
        // billing row from the moment it exists, so no read has to special-case
        // its absence.
        subscription: {
          create: {
            plan,
            // `pending` until a processor says otherwise. Nothing has been
            // charged and nothing has been authorised.
            status: 'pending',
            cardBrand: body.card?.brand ?? null,
            cardLast4: body.card?.last4 ?? null,
            cardExpMonth: body.card?.expMonth ?? null,
            cardExpYear: body.card?.expYear ?? null,
            cardholderName: body.card?.cardholderName ?? null,
          },
        },
      },
      select: { id: true },
    });
  } catch {
    // The case-insensitive unique index is the real guard; the check above is
    // only there to give a friendlier error in the common case.
    return fail(409, 'EMAIL_TAKEN');
  }

  // Every student starts with the official sitting on their calendar, so the
  // scheduler has something to plan towards from day one.
  await db.upcomingExam.create({
    data: {
      userId: user.id,
      examDate: nextMidJune(),
      label: 'Baccalauréat',
      isBacExam: true,
    },
  });

  /*
   * The confirmation, sent before the session is issued.
   *
   * `sendEmail` never throws and returns false rather than failing the request:
   * an account that exists with an unsent confirmation can ask for another one,
   * whereas a signup that 500s because mail was down loses the account and the
   * student's answers to the whole form.
   */
  const verifyToken = await issueToken(user.id, 'email_verify');
  await sendEmail({
    // `email`, not `user.email`: the create above selects only the id, and the
    // normalised address is already in hand from validation.
    to: email,
    subject: 'Confirm your Bac II account',
    text: [
      body.displayName ? `Hello ${body.displayName.split(' ')[0]},` : 'Hello,',
      '',
      'Confirm your email address to start studying:',
      '',
      appLink(`/verify-email?token=${encodeURIComponent(verifyToken)}`),
      '',
      'The link works for 24 hours.',
    ].join('\n'),
  });

  await createSession(user.id);

  await recordAudit({
    actorUserId: user.id,
    action: AuditAction.SIGNUP,
    targetType: 'user',
    targetId: user.id,
    metadata: {
      trackId: track.id,
      language: body.preferredLanguage,
      country,
      plan,
      cardOnFile: Boolean(body.card),
    },
  });

  return created({ ok: true });
});

function nextMidJune(): Date {
  const now = new Date();
  const thisYear = new Date(Date.UTC(now.getUTCFullYear(), 5, 15));
  return thisYear > now ? thisYear : new Date(Date.UTC(now.getUTCFullYear() + 1, 5, 15));
}
