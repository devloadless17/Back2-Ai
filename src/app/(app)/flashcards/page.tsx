import type { Metadata } from 'next';

import { ScopeSelector, type ScopeSubject, type WeakScope } from '@/components/flashcards/scope-selector';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { format, formatDate } from '@/lib/i18n/format';
import { countDue, deckSummary, dueCountsByChapter, weakChapters } from '@/lib/queries/flashcards';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t.flashcards.title };
}

/**
 * The deck, and where to start.
 *
 * Zero due is a good outcome and is presented as one. The alternative — an
 * empty list with a grey "no items" label — takes the one moment in the week
 * when a student is genuinely on top of their revision and makes it look like a
 * bug.
 *
 * The scope selector is the exec plan's chapter | unit | whole-curriculum
 * choice, with the due count shown at every level: "revise one chapter" is only
 * a useful option if you can see which chapter has cards waiting.
 */
export default async function FlashcardsPage() {
  const user = await requireUser();
  const { locale, t } = await getTranslations();

  const [summary, dueByChapter, subjects, weakest, weakDue] = await Promise.all([
    deckSummary(user.id),
    dueCountsByChapter(user.id),
    db.subject.findMany({
      where: { trackId: user.trackId ?? undefined },
      select: {
        id: true,
        name: true,
        units: { select: { id: true, name: true }, orderBy: { orderIndex: 'asc' } },
        chapters: {
          select: { id: true, name: true, unitId: true },
          orderBy: { orderIndex: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    }),
    weakChapters(user.id, user.trackId),
    countDue(user.id, user.trackId, { kind: 'weak' }),
  ]);

  const weak: WeakScope = {
    due: weakDue,
    chapters: weakest.map((chapter) => ({
      id: chapter.chapterId,
      name: chapter.chapterName,
      subjectName: chapter.subjectName,
      masteryScore: chapter.masteryScore,
    })),
  };

  const dueByChapterId = new Map(dueByChapter.map((row) => [row.chapterId, row.due]));

  // Chapters and units with nothing due are dropped: a selector listing 55
  // chapters of which 3 have cards is a list nobody reads to the end of.
  const scopeSubjects: ScopeSubject[] = subjects
    .map((subject) => {
      const chapters = subject.chapters
        .map((chapter) => ({
          id: chapter.id,
          name: chapter.name,
          unitId: chapter.unitId,
          due: dueByChapterId.get(chapter.id) ?? 0,
        }))
        .filter((chapter) => chapter.due > 0);

      const units = subject.units
        .map((unit) => ({
          id: unit.id,
          name: unit.name,
          due: chapters.filter((c) => c.unitId === unit.id).reduce((sum, c) => sum + c.due, 0),
          chapters: chapters.filter((c) => c.unitId === unit.id),
        }))
        .filter((unit) => unit.due > 0);

      return {
        id: subject.id,
        name: subject.name,
        due: chapters.reduce((sum, c) => sum + c.due, 0),
        units,
        ungroupedChapters: chapters.filter((c) => c.unitId === null),
      };
    })
    .filter((subject) => subject.due > 0);

  return (
    <>
      <PageHeader
        title={t.flashcards.title}
        description={t.flashcards.subtitle}
        actions={
          summary.due > 0 ? (
            <LinkButton href="/flashcards/review" variant="primary">
              {t.flashcards.startReview}
            </LinkButton>
          ) : null
        }
      />

      {summary.total === 0 ? (
        <EmptyState
          tone="neutral"
          title={t.flashcards.emptyDeck}
          body={t.flashcards.emptyDeckHint}
          action={
            <LinkButton href="/practice" variant="primary">
              {t.dashboard.noActivityCta}
            </LinkButton>
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Sheet className="lg:col-span-2">
            <SheetHeader title={t.dashboard.dueToday} />
            <SheetBody>
              {summary.due > 0 ? (
                <div className="space-y-3">
                  <p className="text-5xl font-extrabold tracking-tight tabular-nums leading-none">
                    {summary.due}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {format(t.flashcards.dueCount, { count: summary.due })}
                  </p>
                  <LinkButton href="/flashcards/review" variant="primary">
                    {t.flashcards.startReview}
                  </LinkButton>
                </div>
              ) : (
                <EmptyState
                  tone="positive"
                  title={t.flashcards.noneDue}
                  body={
                    summary.nextDueDate
                      ? `${t.flashcards.noneDueHint} (${formatDate(locale, summary.nextDueDate)})`
                      : t.flashcards.noneDueHint
                  }
                  className="border-0 bg-transparent px-0 py-2"
                />
              )}
            </SheetBody>
          </Sheet>

          <ScopeSelector subjects={scopeSubjects} totalDue={summary.due} weak={weak} />
        </div>
      )}
    </>
  );
}
