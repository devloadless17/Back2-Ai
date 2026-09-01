import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import type { Role, Language } from '@prisma/client';

import { db } from '@/lib/db';
import { env } from '@/lib/env';

export const SESSION_COOKIE = 'bac2_session';

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
  trackId: string | null;
  preferredLanguage: Language;
  /** ISO 3166-1 alpha-2, chosen at signup. */
  country: string;
  displayName: string | null;
  /** What this student calls their tutor. Null until they have named it. */
  tutorName: string | null;
};

export type ActiveSession = {
  sessionId: string;
  user: SessionUser;
};

/**
 * Sessions are opaque random tokens looked up server-side, not signed JWTs.
 *
 * The trade is one indexed lookup per request in exchange for the ability to
 * revoke a live session instantly. For a product that proctors official exams,
 * being able to terminate a session mid-attempt is a requirement, not a nicety,
 * and a stateless JWT cannot offer it.
 */

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const ip = forwarded ? (forwarded.split(',')[0] ?? '').trim() || null : h.get('x-real-ip');
  return { ip, userAgent: h.get('user-agent') };
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const { ip, userAgent } = await requestContext();
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_DAYS * 86_400_000);

  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: ip,
      userAgent: userAgent?.slice(0, 512) ?? null,
    },
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });

  return token;
}

/**
 * Resolves the current session. Wrapped in React `cache` so that a page and all
 * of its nested server components share one database round-trip per request.
 */
export const getSession = cache(async (): Promise<ActiveSession | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      lastSeenAt: true,
      tokenHash: true,
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          trackId: true,
          preferredLanguage: true,
          country: true,
          displayName: true,
          tutorName: true,
          isActive: true,
        },
      },
    },
  });

  if (!row) return null;

  // Compare again in constant time. The unique-index lookup already matched,
  // but this keeps the comparison off the database's collation behaviour.
  const a = Buffer.from(row.tokenHash, 'utf8');
  const b = Buffer.from(hashToken(token), 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (row.revokedAt) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  if (!row.user.isActive) return null;

  // Throttled activity heartbeat — avoids a write on every single request.
  if (Date.now() - row.lastSeenAt.getTime() > 5 * 60_000) {
    void db.session
      .update({ where: { id: row.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {
        /* heartbeat is best-effort; never fail a request over it */
      });
  }

  return {
    sessionId: row.id,
    user: {
      id: row.user.id,
      email: row.user.email,
      role: row.user.role,
      trackId: row.user.trackId,
      preferredLanguage: row.user.preferredLanguage,
      country: row.user.country,
      displayName: row.user.displayName,
      tutorName: row.user.tutorName,
    },
  };
});

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.session
      .updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
  }

  jar.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

/** Used on password change and by admin account suspension. */
export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  const res = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

/** Housekeeping for the cron job; expired rows have no value after their TTL. */
export async function purgeExpiredSessions(): Promise<number> {
  const res = await db.session.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } },
  });
  return res.count;
}
