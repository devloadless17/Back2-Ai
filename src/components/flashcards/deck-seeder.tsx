'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { ApiRequestError, sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

/**
 * Filling a deck without having practised first.
 *
 * The deck is built from questions the student has attempted, which is the
 * right rule for what a card *means* and leaves a new student with nothing: an
 * empty screen whose only instruction is to go and do something else first.
 * This writes ten cards from a chapter's own textbook passages instead.
 *
 * Deliberately its own panel rather than a button bolted into the scope
 * selector. That tree lists only nodes with cards due — a documented decision,
 * and a good one, because a tree of two hundred chapters reading zero is a
 * worse way to find the three that matter. Seeding needs the opposite list:
 * every chapter, especially the ones with nothing. Two lists, two jobs.
 */

export type SeedChapter = { id: string; name: string };
export type SeedSubject = { id: string; name: string; chapters: SeedChapter[] };

export function DeckSeeder({
  subjects,
  initialSubjectId,
}: {
  subjects: SeedSubject[];
  /**
   * The subject the student arrived from, when they came here from a subject
   * whose deck was empty. Ignored if it names a subject they cannot study, so a
   * hand-edited URL falls back to the first rather than selecting nothing.
   */
  initialSubjectId?: string;
}) {
  const { t } = useI18n();

  const start = subjects.find((s) => s.id === initialSubjectId) ?? subjects[0];

  const [subjectId, setSubjectId] = useState(start?.id ?? '');
  const [chapterId, setChapterId] = useState(start?.chapters[0]?.id ?? '');

  const subject = subjects.find((s) => s.id === subjectId) ?? subjects[0];

  if (subjects.length === 0) return null;

  return (
    <Sheet>
      <SheetHeader title={t.flashcards.seedTitle} description={t.flashcards.seedHint} />
      <SheetBody className="space-y-3">
        <Select
          aria-label={t.practice.title}
          value={subjectId}
          onChange={(event) => {
            const next = subjects.find((s) => s.id === event.target.value);
            setSubjectId(event.target.value);
            // The chapter list changes with the subject, so a stale selection
            // would post a chapter from the subject the student just left.
            setChapterId(next?.chapters[0]?.id ?? '');
          }}
        >
          {subjects.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>

        <Select
          aria-label={t.flashcards.scope}
          value={chapterId}
          onChange={(event) => setChapterId(event.target.value)}
        >
          {(subject?.chapters ?? []).map((chapter) => (
            <option key={chapter.id} value={chapter.id}>
              {chapter.name}
            </option>
          ))}
        </Select>

        <SeedButton chapterId={chapterId} label={t.flashcards.seedCta} variant="primary" />
      </SheetBody>
    </Sheet>
  );
}

/**
 * One chapter, one button.
 *
 * Split out because the same action belongs in two places: this panel, and
 * beside a weak chapter in the scope selector, where "there is nothing due in
 * your worst chapter" is the moment a student most wants more cards from it.
 *
 * It refreshes rather than pushing the new cards into local state. The counts
 * this changes are computed on the server in four different places — the deck
 * summary, the scope tree, the sidebar badge, the dashboard tile — and
 * `router.refresh()` re-reads all of them from the one source of truth.
 */
export function SeedButton({
  chapterId,
  label,
  variant = 'secondary',
  size = 'md',
}: {
  chapterId: string;
  label: string;
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md';
}) {
  const { t, format } = useI18n();
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(
    null,
  );

  async function generate() {
    if (!chapterId) return;
    setBusy(true);
    setMessage(null);

    try {
      const result = await sendJson<{ added: number; status: string }>(
        '/api/flashcards/generate',
        'POST',
        { chapterId },
      );

      // Four outcomes, four different things to say. "Nothing happened" is the
      // one answer that would leave a student unable to tell a missing API key
      // from a chapter with no textbook loaded from one that simply had no
      // definitions in it.
      if (result.status === 'not_configured') {
        setMessage({ tone: 'warning', text: t.flashcards.seedNotConfigured });
      } else if (result.status === 'no_material') {
        setMessage({ tone: 'warning', text: t.flashcards.seedNoMaterial });
      } else if (result.added === 0) {
        setMessage({ tone: 'warning', text: t.flashcards.seedNone });
      } else {
        setMessage({
          tone: 'success',
          text: format(t.flashcards.seedAdded, { count: result.added }),
        });
        router.refresh();
      }
    } catch (error) {
      // `sendJson` throws a typed error carrying the status, so the rate limit
      // is read off that rather than sniffed out of a message string.
      const tooMany = error instanceof ApiRequestError && error.status === 429;
      setMessage({
        tone: 'error',
        text: tooMany ? t.flashcards.seedTooMany : t.common.unknownError,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        variant={variant}
        size={size}
        loading={busy}
        disabled={!chapterId}
        onClick={() => void generate()}
      >
        {busy ? t.flashcards.seedGenerating : label}
      </Button>

      {message && (
        <Alert tone={message.tone === 'success' ? 'success' : message.tone}>{message.text}</Alert>
      )}
    </div>
  );
}
