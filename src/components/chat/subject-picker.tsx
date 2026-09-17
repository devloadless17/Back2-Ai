'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Sheet, SheetBody } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { subjectIcon } from '@/lib/subject-icon';

export type PickableSubject = {
  id: string;
  name: string;
  language: string;
  /**
   * Chapters with something to practise, shown under the name.
   *
   * A picker that offers fifteen identical tiles tells a student nothing about
   * which of them is worth opening. This is the cheapest true signal available
   * — it is already counted for the practice index — and it quietly warns that
   * a thin subject is thin before they ask it a question and get a refusal.
   */
  chapterCount: number;
};

/**
 * Which subject a conversation is about, asked before the first message.
 *
 * NOT DECORATION, AND NOT ONLY FOR THE STUDENT'S BENEFIT. Until this existed
 * every question was searched against every subject of the student's track at
 * once — around fifteen, across two scripts. `retrieval.ts` records what that
 * costs: asked "quelle est la différence entre le doute et la philosophie ?"
 * it ranks a French literature passage at 0.528 and the Arabic philosophy
 * chapter that actually answers it at 0.399, and answers confidently from the
 * wrong subject. Naming the subject removes that error outright rather than
 * defending against it, and the student always knew the answer — they are
 * revising one subject at a time.
 *
 * It is also the precondition for per-subject thresholds. The concept gate is
 * two numbers today, 0.50 and 0.45, and real questions sit at 0.331 in GS
 * جغرافيا and 0.713 in GS Chimie — the same gate refuses two thirds of real
 * geography questions and nothing at all in chemistry. A gate cannot be chosen
 * per subject while a question is searched against fifteen of them at once.
 *
 * GENERAL HELP IS A REAL CHOICE, not an escape hatch grudgingly provided. A
 * student who does not know which subject their question belongs to is the
 * student who most needs answering, and "I don't know" is a common, honest
 * state at the start of a question. It keeps the old behaviour — every subject
 * in scope — so choosing it costs nothing and skipping the picker is never
 * required.
 */
export function SubjectPicker({
  sessionId,
  subjects,
  labels,
}: {
  sessionId: string;
  subjects: PickableSubject[];
  labels: {
    title: string;
    hint: string;
    any: string;
    anyHint: string;
    chapters: string;
    error: string;
  };
}) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function choose(subjectId: string | null) {
    setSaving(subjectId ?? 'any');
    setFailed(false);
    try {
      const response = await fetch(`/api/chat/sessions/${sessionId}/subject`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectId }),
      });
      if (!response.ok) throw new Error('failed');
      router.refresh();
    } catch {
      // The picker must never be a dead end: a failed write leaves the student
      // looking at the same screen with no way forward, so it says so and lets
      // them try again rather than silently doing nothing.
      setFailed(true);
      setSaving(null);
    }
  }

  return (
    <Sheet>
      <SheetBody>
        <p className="text-sm font-medium text-ink">{labels.title}</p>
        <p className="mt-1 text-caption text-ink-faint">{labels.hint}</p>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {subjects.map((subject) => (
            <button
              key={subject.id}
              type="button"
              disabled={saving !== null}
              onClick={() => choose(subject.id)}
              /*
               * `dir` goes on the NAME, not on the card — see the span below.
               *
               * Setting it here flipped the whole flex row, so Arabic subjects
               * put their icon on the right and their text hard against the
               * far edge while the Latin ones did the opposite. In a grid that
               * mixes both — which every Lebanese track does — the result is a
               * ragged column that looks like a rendering fault rather than
               * like two languages.
               */
              className={cn(
                'group flex items-center gap-3 rounded-xl border border-rule bg-paper-raised px-4 py-3.5',
                'text-start transition-all duration-150',
                'hover:-translate-y-px hover:border-primary hover:shadow-sm',
                'disabled:pointer-events-none disabled:opacity-50',
                saving === subject.id && 'border-primary shadow-sm',
              )}
            >
              {/*
                The icon sits in a tinted tile rather than loose beside the text.
                A bare emoji at text size disappears into the label; a tile the
                eye can land on is what makes a grid scannable, which is the
                whole job of this screen.
              */}
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-paper-sunken text-lg transition-colors duration-150 group-hover:bg-primary-soft"
              >
                {subjectIcon(subject.name)}
              </span>

              <span className="min-w-0 flex-1">
                {/*
                  The name carries its own direction so Arabic punctuation and
                  any Latin fragment inside it — "SE اقتصاد" — render correctly,
                  while the card itself stays laid out like every other card.
                */}
                <span
                  lang={subject.language}
                  dir={subject.language === 'ar' ? 'rtl' : 'ltr'}
                  className="block truncate text-sm font-medium text-ink"
                >
                  {subject.name}
                </span>
                {subject.chapterCount > 0 && (
                  <span className="block text-caption text-ink-faint">
                    {labels.chapters.replace('{count}', String(subject.chapterCount))}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={saving !== null}
          onClick={() => choose(null)}
          className={cn(
            'mt-3 w-full rounded-lg px-4 py-2.5 text-start transition-colors duration-150',
            'hover:bg-paper-sunken disabled:opacity-50',
          )}
        >
          <span className="text-sm text-ink">{labels.any}</span>
          <span className="ms-2 text-caption text-ink-faint">{labels.anyHint}</span>
        </button>

        {failed && <p className="mt-3 text-caption text-danger">{labels.error}</p>}
      </SheetBody>
    </Sheet>
  );
}
