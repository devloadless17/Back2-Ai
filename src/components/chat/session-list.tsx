'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

export type ChatSessionRow = {
  id: string;
  title: string | null;
  updatedAt: string;
  messageCount: number;
  /** The line of the conversation that matched, when this is a search result. */
  excerpt: string | null;
};

/**
 * The conversation list, with deletion.
 *
 * DELETING ASKS TWICE, in place. A conversation is the student's own writing and
 * there is no undo — the row is gone and the messages with it — so the first
 * press turns the control into a confirmation rather than opening a dialog. In
 * place because a modal over a list of near-identical rows makes it easy to
 * confirm the wrong one: here the row being deleted is the row you are looking
 * at.
 *
 * The list is server-rendered and `router.refresh()` re-fetches it, so the
 * ordering and the search that produced it survive the delete. Removing the row
 * locally instead would drift from the server's idea of the list the moment the
 * student had two tabs open.
 */
export function SessionList({
  sessions,
  dateFor,
}: {
  sessions: ChatSessionRow[];
  /** Pre-formatted on the server: the locale's date format lives there. */
  dateFor: Record<string, string>;
}) {
  const { t } = useI18n();
  const router = useRouter();

  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setError(null);
    setBusy(id);
    try {
      await sendJson(`/api/chat/sessions/${id}`, 'DELETE');
      setConfirming(null);
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error ? (
        <div className="px-5 pt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      <ul className="ruled">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center gap-2 pe-3">
            <Link
              href={`/chat/${session.id}`}
              className="flex min-w-0 flex-1 items-baseline justify-between gap-4 px-5 py-3.5 transition-colors duration-150 hover:bg-paper-sunken"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">
                  {session.title ?? t.chat.newSession}
                </span>
                {session.excerpt ? (
                  <span className="mt-0.5 block truncate text-caption text-ink-faint">
                    {session.excerpt}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-caption text-ink-faint">
                {dateFor[session.id]}
              </span>
            </Link>

            {confirming === session.id ? (
              <span className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="mark"
                  disabled={busy === session.id}
                  onClick={() => remove(session.id)}
                >
                  {t.chat.deleteConfirm}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="quiet"
                  onClick={() => setConfirming(null)}
                >
                  {t.common.cancel}
                </Button>
              </span>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="quiet"
                aria-label={`${t.chat.deleteSession} — ${session.title ?? t.chat.newSession}`}
                onClick={() => setConfirming(session.id)}
              >
                {t.chat.deleteSession}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
