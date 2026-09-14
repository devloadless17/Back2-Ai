import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { TutorAnchor } from '@/components/chat/tutor-context';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { BackLink } from '@/components/ui/back-link';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import { summariseChapter } from '@/lib/summaries';

export const metadata: Metadata = { title: 'Summary' };

/**
 * One chapter's summary.
 *
 * Written once and then stored, in `chapter_summaries`, keyed on the chapter
 * AND on the exact set of passage ids it was written from — so a chapter that
 * has been re-chunked since gets a fresh summary rather than a stale one served
 * confidently. The first view of a chapter pays for a model call; every view
 * after it is free.
 *
 * THAT FIRST VIEW IS EXPENSIVE, and worth knowing the size of: measured at
 * $0.10-0.17 for a nineteen-passage chapter, which is the most costly thing a
 * student can set off with one click. It is the flagship model at high effort,
 * and that IS the right setting — `scripts/compare-summary-models.ts` compared
 * it against two cheaper ones on the same chapter and both were visibly
 * thinner, 10 and 5 key points against 16, not merely cheaper to produce.
 *
 * So the lever here is cache coverage, not price per summary, and coverage is
 * currently four chapters out of 1,157 that have material to summarise.
 *
 * The provenance notice is not decoration. A summary reads as authoritative and
 * gets revised from without being questioned, so a student has to be able to see
 * whether a teacher wrote it or a model did.
 */
export default async function ChapterSummaryPage({
  params,
}: {
  params: Promise<{ subjectId: string; chapterId: string }>;
}) {
  const { subjectId, chapterId } = await params;
  const user = await requireUser();
  const { t } = await getTranslations();

  // Both ids come from the URL, so both are verified against the student's own
  // track in one query rather than trusted.
  const chapter = await db.chapter.findFirst({
    where: { id: chapterId, subjectId, subject: { trackId: user.trackId ?? undefined } },
    select: { id: true, name: true, subject: { select: { id: true, name: true } } },
  });
  if (!chapter) notFound();

  const summary = await summariseChapter(chapter.id);

  return (
    <>
      <TutorAnchor label={chapter.name} />

      <BackLink href={`/summaries/${chapter.subject.id}`} label={chapter.subject.name} />

      <PageHeader title={chapter.name} description={chapter.subject.name} />

      <Link
        href={`/summaries/${chapter.subject.id}`}
        className="mb-5 inline-block text-meta text-ink-faint underline-offset-2 hover:underline"
      >
        ← {chapter.subject.name}
      </Link>

      {summary.status !== 'ok' ? (
        <EmptyState
          tone="pending"
          title={summary.status === 'no_material' ? t.summaries.empty : t.summaries.failed}
          body={t.summaries.emptyHint}
        />
      ) : (
        <div className="space-y-5">
          <Alert tone={summary.source === 'teacher' ? 'info' : 'warning'}>
            {summary.source === 'teacher' ? t.summaries.teacherNotice : t.summaries.generatedNotice}
            {summary.batched ? ` ${t.summaries.batchedNotice}` : ''}
          </Alert>

          <Sheet>
            <SheetHeader title={t.summaries.overview} />
            <SheetBody>
              <p className="text-sm leading-relaxed text-ink">{summary.overview}</p>
              <p className="mt-3 text-caption text-ink-faint">
                {format(t.summaries.writtenFrom, { count: summary.sourceChunkIds.length })}
                {summary.pastQuestions > 0
                  ? ` · ${format(t.summaries.pastQuestions, { count: summary.pastQuestions })}`
                  : ''}
              </p>
            </SheetBody>
          </Sheet>

          {summary.keyPoints.length > 0 && (
            <Sheet>
              <SheetHeader title={t.summaries.keyPoints} />
              <SheetBody className="p-0">
                <ul className="ruled">
                  {summary.keyPoints.map((point, index) => (
                    <li key={`${point.heading}-${index}`} className="px-5 py-3.5">
                      <p className="text-sm font-medium text-ink">{point.heading}</p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-muted">{point.detail}</p>
                    </li>
                  ))}
                </ul>
              </SheetBody>
            </Sheet>
          )}

          {/* Absent when the textbook raised no pitfalls. The generator is told
              an empty list is a correct answer, so an empty section here means
              the book warned about nothing — not that the summary is missing a
              part. Rendering a heading over nothing would suggest otherwise. */}
          {summary.watchOut.length > 0 && (
            <Sheet>
              <SheetHeader title={t.summaries.watchOut} />
              <SheetBody className="p-0">
                <ul className="ruled">
                  {summary.watchOut.map((item, index) => (
                    <li key={index} className="flex gap-3 px-5 py-3">
                      <Badge tone="partial">!</Badge>
                      <p className="text-sm leading-relaxed text-ink-muted">{item}</p>
                    </li>
                  ))}
                </ul>
              </SheetBody>
            </Sheet>
          )}
        </div>
      )}
    </>
  );
}
