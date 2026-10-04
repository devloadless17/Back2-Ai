'use client';

import { useState } from 'react';

import { LinkButton } from '@/components/ui/button';
import { Meter } from '@/components/ui/progress';
import { useI18n } from '@/lib/i18n/client';

export type PickerChapter = {
  id: string;
  name: string;
  unitName: string | null;
  questionCount: number;
  attemptsCount: number;
  masteryScore: number;
  /** Has questions to practise, or reading material to open. */
  openable: boolean;
};

/**
 * One dropdown instead of every chapter listed down the page.
 *
 * A subject runs to twenty or thirty chapters, and the list put all of them
 * between the student and anything else on the page. Choosing one is the act;
 * a dropdown is that act, with the chapter's figures shown once it is chosen.
 * Units become option groups, so the syllabus order and grouping survive.
 */
export function ChapterPicker({
  subjectId,
  chapters,
  initialId,
}: {
  subjectId: string;
  chapters: PickerChapter[];
  initialId: string | null;
}) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState(initialId ?? chapters.find((c) => c.openable)?.id ?? '');
  const selected = chapters.find((c) => c.id === selectedId) ?? null;

  const units = new Map<string, PickerChapter[]>();
  for (const chapter of chapters) {
    const key = chapter.unitName ?? '';
    units.set(key, [...(units.get(key) ?? []), chapter]);
  }

  const option = (chapter: PickerChapter) => (
    <option key={chapter.id} value={chapter.id} disabled={!chapter.openable}>
      {chapter.name}
      {chapter.questionCount > 0 ? ` (${chapter.questionCount})` : ''}
    </option>
  );

  return (
    <div className="rounded-2xl border border-rule bg-paper-raised p-4 shadow-sheet sm:p-5">
      <label className="block">
        <span className="text-meta font-medium text-ink">{t.hub.chooseChapter}</span>
        <select
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          className="mt-2 h-12 w-full rounded-xl border border-rule-strong bg-paper-raised px-3 text-body text-ink hover:border-ink-faint"
        >
          {[...units.entries()].map(([unit, list]) =>
            unit ? (
              <optgroup key={unit} label={unit}>
                {list.map(option)}
              </optgroup>
            ) : (
              list.map(option)
            ),
          )}
        </select>
      </label>

      {selected && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="min-w-40 flex-1">
            <p className="text-caption text-ink-faint">
              {selected.questionCount > 0
                ? `${selected.questionCount} · ${selected.attemptsCount} ${t.practice.attempts}`
                : t.practice.readingOnly}
            </p>
            {selected.attemptsCount > 0 && (
              <div className="mt-1.5 max-w-56">
                <Meter value={selected.masteryScore} size="sm" />
              </div>
            )}
          </div>
          <LinkButton href={`/practice/${subjectId}/${selected.id}`} variant="primary">
            {t.hub.practise}
          </LinkButton>
          {selected.questionCount > 0 && (
            <LinkButton href={`/practice/${subjectId}/${selected.id}/quiz`} variant="secondary">
              {t.todos.actionQuiz}
            </LinkButton>
          )}
        </div>
      )}
    </div>
  );
}
