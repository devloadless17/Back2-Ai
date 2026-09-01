'use client';

import Link from 'next/link';
import { useState } from 'react';

import { SeedButton } from '@/components/flashcards/deck-seeder';
import { Badge } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';

/**
 * Review scope: whole curriculum, a subject, a unit, or a single chapter.
 *
 * Collapsed to subjects by default and expanded on demand. A student with cards
 * due across six subjects wants "everything" most days; the narrow scopes exist
 * for the day before a test on one unit, and that is a deliberate act, not the
 * default view.
 *
 * Only nodes with cards actually due are listed — a tree of every chapter in
 * the programme, almost all reading zero, is a worse way to find the three that
 * matter.
 */

export type ScopeChapter = { id: string; name: string; unitId: string | null; due: number };

export type WeakScope = {
  /** Whether the deck may be topped up from the textbook. */
  /** Cards due inside the weak chapters. Zero still offers the scope — it tops up. */
  due: number;
  chapters: { id: string; name: string; subjectName: string; masteryScore: number }[];
};

export type ScopeSubject = {
  id: string;
  name: string;
  due: number;
  units: { id: string; name: string; due: number; chapters: ScopeChapter[] }[];
  ungroupedChapters: ScopeChapter[];
};

export function ScopeSelector({
  subjects,
  totalDue,
  weak,
}: {
  subjects: ScopeSubject[];
  totalDue: number;
  weak: WeakScope;
}) {
  const { t, formatPercent } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [weakOpen, setWeakOpen] = useState(false);

  return (
    <Sheet className="h-fit">
      <SheetHeader title={t.flashcards.scope} />
      <SheetBody className="p-0">
        <ul className="ruled">
          {/* Whole curriculum */}
          <li>
            <ScopeRow href="/flashcards/review" label={t.flashcards.scopeAll} due={totalDue} strong />
          </li>

          {/* What the student is worst at, which is rarely the same as what is
              due. Listed second so it sits beside "everything" as the other way
              to start, rather than at the bottom under the chapter tree. */}
          {weak.chapters.length > 0 && (
            <li>
              <div className="flex items-stretch">
                <ScopeRow
                  href="/flashcards/review?scope=weak"
                  label={t.flashcards.scopeWeak}
                  due={weak.due}
                  strong
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => setWeakOpen((open) => !open)}
                  aria-expanded={weakOpen}
                  aria-label={t.flashcards.weakChapters}
                  className="px-3 text-ink-faint transition-colors hover:bg-paper-sunken hover:text-ink"
                >
                  <span
                    className={cn(
                      'block text-micro transition-transform duration-150',
                      weakOpen && 'rotate-90',
                    )}
                    aria-hidden="true"
                  >
                    ▶
                  </span>
                </button>
              </div>

              {weakOpen && (
                <ul className="animate-fade-up border-t border-rule bg-paper-sunken/40 px-5 py-2">
                  {weak.chapters.map((chapter) => (
                    <li key={chapter.id} className="py-1.5 text-meta">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-ink-muted">
                          {chapter.name}
                          <span className="text-ink-faint"> · {chapter.subjectName}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-ink-faint">
                          {formatPercent(chapter.masteryScore)}
                        </span>
                      </div>

                      {/*
                        Top up the chapter the student is worst at, from here.
                        This list is where they have just been told which
                        chapters those are, and "nothing is due in your weakest
                        chapter" is exactly the moment more cards are wanted —
                        sending them to a picker at the bottom of the page to
                        re-select a chapter they are already looking at is the
                        kind of small friction that stops a feature being used.
                      */}
                      <div className="mt-1.5">
                        <SeedButton
                          chapterId={chapter.id}
                          label={t.flashcards.seedTopUp}
                          size="sm"
                        />
                      </div>
                    </li>
                  ))}
                  <li className="pt-1.5 text-caption leading-snug text-ink-faint">
                    {t.flashcards.scopeWeakHint}
                  </li>
                </ul>
              )}
            </li>
          )}

          {subjects.map((subject) => {
            const isOpen = expanded === subject.id;
            const hasChildren = subject.units.length > 0 || subject.ungroupedChapters.length > 0;

            return (
              <li key={subject.id}>
                <div className="flex items-stretch">
                  <ScopeRow
                    href={`/flashcards/review?scope=subject&id=${subject.id}`}
                    label={subject.name}
                    due={subject.due}
                    className="flex-1"
                  />
                  {hasChildren && (
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : subject.id)}
                      aria-expanded={isOpen}
                      aria-label={subject.name}
                      className="px-3 text-ink-faint transition-colors hover:bg-paper-sunken hover:text-ink"
                    >
                      <span
                        className={cn(
                          'block text-micro transition-transform duration-150',
                          isOpen && 'rotate-90',
                        )}
                        aria-hidden="true"
                      >
                        ▶
                      </span>
                    </button>
                  )}
                </div>

                {isOpen && (
                  <ul className="animate-fade-up border-t border-rule bg-paper-sunken/40">
                    {subject.units.map((unit) => (
                      <li key={unit.id}>
                        <ScopeRow
                          href={`/flashcards/review?scope=unit&id=${unit.id}`}
                          label={unit.name}
                          due={unit.due}
                          indent={1}
                          muted
                        />
                        <ul>
                          {unit.chapters.map((chapter) => (
                            <li key={chapter.id}>
                              <ScopeRow
                                href={`/flashcards/review?scope=chapter&id=${chapter.id}`}
                                label={chapter.name}
                                due={chapter.due}
                                indent={2}
                                muted
                              />
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}

                    {subject.ungroupedChapters.map((chapter) => (
                      <li key={chapter.id}>
                        <ScopeRow
                          href={`/flashcards/review?scope=chapter&id=${chapter.id}`}
                          label={chapter.name}
                          due={chapter.due}
                          indent={1}
                          muted
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </SheetBody>
    </Sheet>
  );
}

function ScopeRow({
  href,
  label,
  due,
  indent = 0,
  strong = false,
  muted = false,
  className,
}: {
  href: string;
  label: string;
  due: number;
  indent?: number;
  strong?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center justify-between gap-3 py-2.5 pe-5 transition-colors duration-150 hover:bg-paper-sunken',
        className,
      )}
      style={{ paddingInlineStart: `${1.25 + indent * 0.85}rem` }}
    >
      <span
        className={cn(
          'min-w-0 truncate',
          strong ? 'text-sm font-medium text-ink' : muted ? 'text-meta text-ink-muted' : 'text-sm text-ink',
        )}
      >
        {label}
      </span>
      {due > 0 && (
        <Badge tone={strong ? 'primary' : 'neutral'} className="shrink-0 tabular-nums">
          {due}
        </Badge>
      )}
    </Link>
  );
}
