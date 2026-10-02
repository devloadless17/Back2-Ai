'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/cn';

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

  /*
   * Small chips under the box, not a grid of cards. The choice is optional
   * (the box already works across every subject), so it sits quietly beneath
   * it: one line of names, "all subjects" first, nothing to read past.
   */
  const chip = cn(
    'rounded-full border border-rule bg-paper-raised px-3.5 py-1.5 text-meta text-ink-muted',
    'transition-colors duration-150 hover:border-rule-strong hover:bg-paper-sunken hover:text-ink',
    'disabled:pointer-events-none disabled:opacity-50',
  );

  return (
    <div className="text-center">
      <p className="text-caption text-ink-faint">{labels.title}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          disabled={saving !== null}
          onClick={() => choose(null)}
          title={labels.anyHint}
          className={cn(chip, saving === 'any' && 'border-primary text-ink')}
        >
          {labels.any}
        </button>
        {subjects.map((subject) => (
          <button
            key={subject.id}
            type="button"
            disabled={saving !== null}
            onClick={() => choose(subject.id)}
            className={cn(chip, saving === subject.id && 'border-primary text-ink')}
          >
            {/* Direction on the name only, so Arabic and Latin chips sit in one row. */}
            <bdi lang={subject.language}>{subject.name}</bdi>
          </button>
        ))}
      </div>
      {failed && <p className="mt-3 text-caption text-danger">{labels.error}</p>}
    </div>
  );
}
