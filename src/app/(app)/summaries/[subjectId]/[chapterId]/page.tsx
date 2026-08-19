import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import { summariseChapter } from '@/lib/summaries';

export const metadata: Metadata = { title: 'Summary' };

/**
 * One chapter's summary.
 *
 * Written on request and not cached, which is the honest state of this page
 * rather than a design choice: there is nowhere to store it yet. Every view
 * costs a model call, so a `chapter_summaries` row keyed on the chapter — with
 * the passage ids it was written from, so it can be invalidated when the chapter
 * is re-chunked — is the next thing this needs.
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
      <PageHeader title={chapter.name} description={chapter.subject.name} />

      <Link
        href={`/summaries/${chapter.subject.id}`}
        className="mb-5 inline-block text-[13px] text-ink-faint underline-offset-2 hover:underline"
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
              <p className="mt-3 text-[12px] text-ink-faint">
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
