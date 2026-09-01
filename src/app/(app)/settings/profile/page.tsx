import type { Metadata } from 'next';

import { PasswordForm } from '@/components/settings/password-form';
import { RevokeSessionsButton } from '@/components/settings/revoke-sessions-button';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { countryName } from '@/lib/countries';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { LOCALE_LABELS } from '@/lib/i18n/config';
import { formatDate } from '@/lib/i18n/format';

export const metadata: Metadata = { title: 'Profile' };

/**
 * Profile.
 *
 * Track and language render as locked fields with an explanation, not as
 * disabled inputs with no reason given. Changing either invalidates a student's
 * entire mastery history, so it is an admin action taken after a conversation —
 * and the screen should say that plainly rather than leaving them clicking a
 * greyed-out select.
 */
export default async function ProfileSettingsPage() {
  const user = await requireUser();
  const { locale, t } = await getTranslations();

  const [track, sessions] = await Promise.all([
    user.trackId
      ? db.track.findUnique({ where: { id: user.trackId }, select: { code: true, name: true } })
      : null,
    db.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, ipAddress: true, userAgent: true, lastSeenAt: true, createdAt: true },
      orderBy: { lastSeenAt: 'desc' },
      take: 10,
    }),
  ]);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Sheet>
        <SheetHeader title={t.settings.profile} />
        <SheetBody className="space-y-4">
          <Field label={t.settings.displayName} locked={user.displayName ?? '—'} />
          <Field label={t.settings.email} locked={user.email} />
          <Field
            label={t.settings.track}
            locked={track ? `${track.name} (${track.code})` : '—'}
            hint={t.settings.lockedHint}
          />
          <Field label={t.settings.language} locked={LOCALE_LABELS[user.preferredLanguage]} />
          <Field label={t.settings.country} locked={countryName(locale, user.country)} />
        </SheetBody>
      </Sheet>

      <div className="space-y-5">
        <Sheet>
          <SheetHeader title={t.settings.changePassword} />
          <SheetBody>
            <PasswordForm />
          </SheetBody>
        </Sheet>

        <Sheet>
          <SheetHeader title={t.settings.activeSessions} />
          <SheetBody className="p-0">
            <ul className="ruled">
              {sessions.map((session) => (
                <li key={session.id} className="px-5 py-3">
                  <p className="truncate text-meta text-ink">
                    {session.userAgent?.slice(0, 60) ?? '—'}
                  </p>
                  <p className="text-caption text-ink-faint">
                    {session.ipAddress ?? '—'} · {formatDate(locale, session.lastSeenAt)}
                  </p>
                </li>
              ))}
            </ul>
          </SheetBody>
          <SheetFooter>
            <RevokeSessionsButton otherSessions={Math.max(0, sessions.length - 1)} />
          </SheetFooter>
        </Sheet>

        <Alert tone="info">{t.auth.lockNotice}</Alert>
      </div>
    </div>
  );
}
