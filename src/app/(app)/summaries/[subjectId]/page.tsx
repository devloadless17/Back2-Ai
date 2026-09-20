import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge, EmptyState } from '@/components/ui/feedback';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { BackLink } from '@/components/ui/back-link';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { cachedChapterSummaries, summariseSubject } from '@/lib/summaries';
import { format } from '@/lib/i18n/format';

export const metadata: Metadata = { title: 'Summaries' };

/**
 * Inside one book: its chapters, in the order the textbook teaches them.
 *
 * Not ordered by how heavily each chapter has been examined, though the count is
 * shown. A student following their book wants to find where they are; a list
 * reordered by exam frequency is a different tool, and silently becomes advice
 * about what to skip.
 */
export default async function SubjectSummaryPage({
  params,
}: {
  params: Promise<{ subjectId: string }>;
}) {
  const { subjectId } = await params;
  const user = await requireUser();
  const { t } = await getTranslations();

  /*
   * Scoped to the student's own track in the query itself, not checked
   * afterwards. A subject id in a URL is client-supplied, and this is the only
   * thing standing between a guessed id and another track's material.
   */
  const subject = await db.subject.findFirst({
    where: { id: subjectId, trackId: user.trackId ?? undefined },
    select: { id: true, name: true },
  });
  if (!subject) notFound();

  const chapters = await db.chapter.findMany({
    where: { subjectId: subject.id },
    select: {
      id: true,
      name: true,
      orderIndex: true,
      unit: { select: { name: true } },
      /*
       * `alsoHasQuestions`, not `questions`: what this chapter may ASK, which
       * is what the quiz serves, rather than where an exercise happens to be
       * filed. The filed count understated the index by 3-5x — see 6be57e6 —
       * and here it is the line that tells a reader whether the chapter is
       * examined at all.
       */
      _count: {
        select: {
          alsoHasQuestions: { where: { question: { verifiedStatus: { not: 'rejected' } } } },
          contentChunks: true,
        },
      },
    },
    orderBy: { orderIndex: 'asc' },
  });

  const readable = chapters.filter((chapter) => chapter._count.contentChunks > 0);

  /*
   * The subject overview, from the chapter summaries that already exist.
   *
   * Only from cached ones, and that restraint is the whole design. Composing it
   * from every chapter would mean opening a subject page triggers a model call
   * per chapter — forty of them on GS mathematics — so the overview appears
   * once chapters have actually been read, and until then the page is the
   * chapter list it has always been. `summariseSubject` caches its own result
   * against the chapter ids it used, so this costs one call, once.
   */
  const written = await cachedChapterSummaries(subject.id);
  const overview =
    written.length >= 2
      ? await summariseSubject({ subjectId: subject.id, chapterSummaries: written })
      : null;

  const byUnit = new Map<string, typeof readable>();
  for (const chapter of readable) {
    const unit = chapter.unit?.name ?? '';
    byUnit.set(unit, [...(byUnit.get(unit) ?? []), chapter]);
  }

  return (
    <>
      {/*
        Back to the subject, not to the dashboard and not to the summary list.
        
        This page is Chemistry's summaries; its parent is Chemistry. Only the
        subject hub itself is a top-level destination — everything hanging off
        a subject returns to that subject, so a student reading a summary goes
        back to the place that holds the practice, the papers and the rest of
        it rather than being thrown to the top.

        `/summaries` was the old target and was wrong twice over: it is a picker
        passed through once, and a second hand-rolled copy of this same link
        sat three lines below, pointing at it too.
      */}
      <BackLink href={`/practice/${subject.id}`} label={subject.name} />
      <PageHeader title={subject.name} description={t.summaries.subtitle} />

      {overview?.status === 'ok' && overview.overview ? (
        <Sheet className="mb-5">
          <SheetBody>
            <p className="text-body leading-relaxed text-ink">{overview.overview}</p>
            <p className="mt-3 text-caption text-ink-faint">{t.summaries.generatedNotice}</p>
          </SheetBody>
        </Sheet>
      ) : null}

      {readable.length === 0 ? (
        <EmptyState tone="pending" title={t.summaries.empty} body={t.summaries.emptyHint} />
      ) : (
        <div className="space-y-5">
          {[...byUnit.entries()].map(([unit, unitChapters]) => (
            <Sheet key={unit || 'none'}>
              <SheetHeader title={unit || t.summaries.chapters} />
              <SheetBody className="p-0">
                <ul className="ruled">
                  {unitChapters.map((chapter) => (
                    <li key={chapter.id}>
                      <Link
                        href={`/summaries/${subject.id}/${chapter.id}`}
                        className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors duration-150 hover:bg-paper-sunken"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">{chapter.name}</p>
                          <p className="text-caption text-ink-faint">
                            {chapter._count.alsoHasQuestions > 0
                              ? format(t.summaries.pastQuestions, {
                                  count: chapter._count.alsoHasQuestions,
                                })
                              : t.summaries.noPastQuestions}
                          </p>
                        </div>
                        <span className="shrink-0 text-caption text-ink-faint">
                          {t.summaries.readSummary}
                        </span>
                        <Badge tone="neutral">{chapter._count.contentChunks}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </SheetBody>
            </Sheet>
          ))}
        </div>
      )}
    </>
  );
}
