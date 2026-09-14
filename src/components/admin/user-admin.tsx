'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Alert, Badge } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { ApiRequestError, sendJson } from '@/lib/client/request';
import { LOCALE_LABELS, STUDY_LANGUAGES } from '@/lib/i18n/config';
import { useI18n } from '@/lib/i18n/client';

export type AdminUserRow = {
  id: string;
  email: string;
  displayName: string | null;
  role: 'student' | 'admin';
  preferredLanguage: 'fr' | 'en' | 'ar';
  isActive: boolean;
  trackId: string | null;
  trackCode: string | null;
  attemptCount: number;
  lastLoginAt: string | null;
  emailVerifiedAt: string | null;
  /** This student's own monthly AI ceiling in dollars, or null if the plan's applies. */
  aiBudgetUsd: number | null;
  /** What the plan would give them, shown as the placeholder when there is no override. */
  planBudgetUsd: number;
};

/**
 * Support actions on a student's account.
 *
 * The reason field is required, not decorative. These are the changes that
 * invalidate a mastery history or lock someone out, and six months from now the
 * only record of why will be what the administrator typed here.
 *
 * The warning about the attempt count is shown because it is the actual
 * consequence: moving a student with 300 attempts to a different track leaves
 * every one of those attempts pointing at chapters they no longer study.
 */
export function UserAdmin({
  users,
  tracks,
}: {
  users: AdminUserRow[];
  tracks: { id: string; label: string }[];
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<AdminUserRow> & { reason?: string }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const visible = users.filter(
    (user) =>
      query.trim().length === 0 ||
      user.email.toLowerCase().includes(query.toLowerCase()) ||
      (user.displayName ?? '').toLowerCase().includes(query.toLowerCase()),
  );

  function startEdit(user: AdminUserRow) {
    setEditing(user.id);
    setDraft({
      trackId: user.trackId,
      preferredLanguage: user.preferredLanguage,
      aiBudgetUsd: user.aiBudgetUsd,
      role: user.role,
      isActive: user.isActive,
      reason: '',
    });
    setError(null);
  }

  /**
   * Sends the confirmation email again.
   *
   * Deliberately does not close the editor or refresh the list: nothing about
   * the account changed, and an administrator who sees the row collapse will
   * reasonably believe the address is now confirmed. Only the notice moves.
   */
  async function resend(user: AdminUserRow) {
    if (!draft.reason || draft.reason.trim().length < 3) {
      setError(t.admin.reviewNotes);
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await sendJson('/api/admin/users', 'POST', { id: user.id, reason: draft.reason.trim() });
      setNotice(t.admin.confirmationSent);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.common.unknownError);
    } finally {
      setBusy(false);
    }
  }

  async function save(user: AdminUserRow) {
    if (!draft.reason || draft.reason.trim().length < 3) {
      setError(t.admin.reviewNotes);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await sendJson('/api/admin/users', 'PATCH', {
        id: user.id,
        trackId: draft.trackId ?? null,
        preferredLanguage: draft.preferredLanguage,
        aiBudgetUsd: draft.aiBudgetUsd ?? null,
        role: draft.role,
        isActive: draft.isActive,
        reason: draft.reason.trim(),
      });
      setEditing(null);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.code === 'CANNOT_DEMOTE_SELF'
          ? t.errors.forbiddenBody
          : t.common.unknownError,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet>
      <SheetHeader
        title={t.admin.users}
        actions={
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.common.search}
            className="h-8 w-48 text-meta"
            aria-label={t.common.search}
          />
        }
      />

      <SheetBody className="p-0">
        {error && (
          <div className="px-5 pt-4">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        {notice && (
          <div className="px-5 pt-4">
            <Alert tone="success">{notice}</Alert>
          </div>
        )}

        <ul className="ruled">
          {visible.map((user) => {
            const isEditing = editing === user.id;

            return (
              <li key={user.id} className={cn('px-5 py-3.5', !user.isActive && 'opacity-60')}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {user.displayName ?? user.email}
                    </p>
                    <p className="text-caption text-ink-faint">
                      {user.email}
                      {user.lastLoginAt ? ` · ${formatDate(user.lastLoginAt)}` : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {user.role === 'admin' && <Badge tone="primary">{t.admin.title}</Badge>}
                    {!user.isActive && <Badge tone="mark">{t.auth.accountDisabled}</Badge>}
                    {!user.emailVerifiedAt && <Badge tone="partial">{t.admin.unconfirmed}</Badge>}
                    <Badge tone="neutral">{user.trackCode ?? '—'}</Badge>
                    <Badge tone="neutral">{LOCALE_LABELS[user.preferredLanguage]}</Badge>
                    <button
                      type="button"
                      onClick={() => (isEditing ? setEditing(null) : startEdit(user))}
                      className="rounded px-2 py-1 text-meta font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {isEditing ? t.common.cancel : t.common.edit}
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-3 animate-fade-up space-y-3 rounded border border-rule bg-paper-sunken/50 p-3">
                    {user.attemptCount > 0 && (
                      <Alert tone="warning">
                        {`${user.attemptCount} ${t.practice.attempts} · ${t.settings.lockedHint}`}
                      </Alert>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1">
                        <span className="block text-meta font-medium text-ink">
                          {t.settings.track}
                        </span>
                        <Select
                          value={draft.trackId ?? ''}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, trackId: event.target.value || null }))
                          }
                        >
                          <option value="">—</option>
                          {tracks.map((track) => (
                            <option key={track.id} value={track.id}>
                              {track.label}
                            </option>
                          ))}
                        </Select>
                      </label>

                      {/*
                        A number box, not a slider or a plan picker: the person
                        using this is deciding "how many dollars should this one
                        student get", and the honest control for that is the
                        number. Empty means the plan's ceiling, which the
                        placeholder states, so an untouched field is visibly
                        "unchanged" rather than "zero".
                      */}
                      <label className="space-y-1">
                        <span className="block text-meta font-medium text-ink">
                          {t.admin.aiBudgetLabel}
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={500}
                          step={0.5}
                          inputMode="decimal"
                          className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                          placeholder={t.admin.aiBudgetPlaceholder.replace(
                            '{n}',
                            user.planBudgetUsd.toFixed(2),
                          )}
                          value={draft.aiBudgetUsd ?? ''}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              aiBudgetUsd:
                                event.target.value === '' ? null : Number(event.target.value),
                            }))
                          }
                        />
                        <span className="block text-caption text-ink-faint">
                          {t.admin.aiBudgetHint}
                        </span>
                      </label>

                      <label className="space-y-1">
                        <span className="block text-meta font-medium text-ink">
                          {t.settings.language}
                        </span>
                        <Select
                          value={draft.preferredLanguage ?? user.preferredLanguage}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              preferredLanguage: event.target.value as AdminUserRow['preferredLanguage'],
                            }))
                          }
                        >
                          {STUDY_LANGUAGES.map((locale) => (
                            <option key={locale} value={locale}>
                              {LOCALE_LABELS[locale]}
                            </option>
                          ))}
                        </Select>
                      </label>

                      <label className="space-y-1">
                        <span className="block text-meta font-medium text-ink">
                          {t.admin.itemType}
                        </span>
                        <Select
                          value={draft.role ?? user.role}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              role: event.target.value as AdminUserRow['role'],
                            }))
                          }
                        >
                          <option value="student">student</option>
                          <option value="admin">admin</option>
                        </Select>
                      </label>

                      <label className="space-y-1">
                        <span className="block text-meta font-medium text-ink">
                          {t.admin.jobStatus}
                        </span>
                        <Select
                          value={String(draft.isActive ?? user.isActive)}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, isActive: event.target.value === 'true' }))
                          }
                        >
                          <option value="true">{t.common.yes}</option>
                          <option value="false">{t.common.no}</option>
                        </Select>
                      </label>
                    </div>

                    <label className="block space-y-1">
                      <span className="block text-meta font-medium text-ink">
                        {t.admin.reviewNotes} <span className="text-mark">*</span>
                      </span>
                      <Input
                        value={draft.reason ?? ''}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, reason: event.target.value }))
                        }
                        placeholder={t.admin.reviewNotes}
                      />
                    </label>

                    <div className="flex flex-wrap justify-end gap-2">
                      {!user.emailVerifiedAt && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => resend(user)}
                          loading={busy}
                        >
                          {t.admin.resendConfirmation}
                        </Button>
                      )}
                      <Button variant="primary" size="sm" onClick={() => save(user)} loading={busy}>
                        {t.common.save}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </SheetBody>

      <SheetFooter>
        <p className="text-caption text-ink-faint">{t.auth.lockNotice}</p>
      </SheetFooter>
    </Sheet>
  );
}
