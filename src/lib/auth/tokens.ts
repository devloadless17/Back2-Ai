import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { db } from '@/lib/db';

/**
 * Single-use links sent to an email address.
 *
 * Confirming an address and resetting a password are the same object with a
 * different purpose: issued, emailed, redeemed once, expired. One table, so
 * there is one place where "has this been used" is decided rather than two
 * implementations that can disagree.
 *
 * Only the hash is stored. A password-reset link is a credential — anyone
 * holding it can take the account — so the database must not contain a working
 * copy of one. This is the same reasoning as session tokens in `session.ts`,
 * and for the same reason it is not negotiable: a leaked dump should expose
 * nothing that can be replayed.
 *
 * Redemption is a conditional update rather than a read followed by a write.
 * Two clicks on the same link arrive as two requests, and a check-then-set can
 * let both through; `updateMany` with `usedAt: null` in the WHERE clause lets
 * the database decide, and exactly one of them updates a row.
 */
export type TokenPurpose = 'email_verify' | 'password_reset';

/**
 * How long a link lives.
 *
 * A day for confirmation: a student who signs up in the evening and opens their
 * mail the next morning should not have to ask for a new one. An hour for a
 * reset, because it is a credential in an inbox and the person asking for it is
 * sitting at the keyboard now.
 */
const TTL_MINUTES: Record<TokenPurpose, number> = {
  email_verify: 24 * 60,
  password_reset: 60,
};

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Issues a token and returns the half that goes in the email.
 *
 * Any unused token of the same purpose is spent first. Otherwise "email me
 * another link" leaves every earlier one live, and a reset link from a mailbox
 * read months later still opens the account.
 */
export async function issueToken(userId: string, purpose: TokenPurpose): Promise<string> {
  const token = randomBytes(32).toString('base64url');

  await db.$transaction([
    db.authToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    }),
    db.authToken.create({
      data: {
        userId,
        purpose,
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + TTL_MINUTES[purpose] * 60_000),
      },
    }),
  ]);

  return token;
}

/**
 * Spends a token, returning the user it belonged to.
 *
 * Null covers every failure — unknown, expired, already used — and the caller
 * must not distinguish them to the person holding the link. "This link has
 * already been used" tells someone who guessed a token that they guessed a real
 * one.
 */
export async function redeemToken(
  token: string,
  purpose: TokenPurpose,
): Promise<{ userId: string } | null> {
  if (!token || token.length < 20) return null;

  const candidate = await db.authToken.findUnique({
    where: { tokenHash: hash(token) },
    select: { id: true, userId: true, purpose: true, expiresAt: true, usedAt: true, tokenHash: true },
  });
  if (!candidate) return null;

  // Compare again in constant time. The unique index already matched, but this
  // keeps the decision off the database's collation behaviour — the same
  // reasoning as `session.ts`.
  const a = Buffer.from(candidate.tokenHash, 'utf8');
  const b = Buffer.from(hash(token), 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (candidate.purpose !== purpose) return null;
  if (candidate.usedAt) return null;
  if (candidate.expiresAt.getTime() <= Date.now()) return null;

  // The database decides who wins a double click, not this process.
  const spent = await db.authToken.updateMany({
    where: { id: candidate.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (spent.count !== 1) return null;

  return { userId: candidate.userId };
}
