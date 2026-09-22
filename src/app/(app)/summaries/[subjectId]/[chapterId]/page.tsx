import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { TutorAnchor } from '@/components/chat/tutor-context';
import { MathText, bodyToRender } from '@/components/ui/math';
import { EmptyState } from '@/components/ui/feedback';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { BackLink } from '@/components/ui/back-link';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { dirForLanguage } from '@/lib/i18n/config';
import { format } from '@/lib/i18n/format';
import { getChapterContent } from '@/lib/summaries';

export const metadata: Metadata = { title: 'Chapter content' };

/**
 * One chapter's material, read straight from the textbook.
 *
 * No model call, no cache, no cost — every view reads `content_chunks` fresh.
 * See `getChapterContent` for why: a chapter used to be summarised by a model
 * before this, and the tradeoff was a fabrication risk a student had no way
 * to catch. This is slower to read than a three-sentence overview and it is
 * the actual book.
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

  const content = await getChapterContent(chapter.id);
  const dir = dirForLanguage(content.subjectLanguage);

  return (
    <>
      <TutorAnchor label={chapter.name} />

      <BackLink href={`/summaries/${chapter.subject.id}`} label={chapter.subject.name} />

      <PageHeader title={chapter.name} description={chapter.subject.name} />

      {content.status !== 'ok' ? (
        <EmptyState tone="pending" title={t.summaries.empty} body={t.summaries.emptyHint} />
      ) : (
        <div className="space-y-5">
          <p className="text-caption text-ink-faint">
            {format(t.summaries.writtenFrom, { count: content.passages.length })}
            {content.pastQuestions > 0
              ? ` · ${format(t.summaries.pastQuestions, { count: content.pastQuestions })}`
              : ''}
          </p>

          <Sheet>
            <SheetHeader title={t.summaries.content} />
            <SheetBody className="p-0">
              <ul className="ruled">
                {content.passages.map((passage) => (
                  <li key={passage.id} className="px-5 py-4">
                    <p className="text-micro font-semibold uppercase tracking-[0.1em] text-ink-faint">
                      {passage.title ||
                        t.evidence.kinds[passage.kind as keyof typeof t.evidence.kinds] ||
                        passage.kind}
                    </p>
                    <div className="mt-1.5 text-sm leading-relaxed text-ink">
                      <MathText dir={dir}>{bodyToRender(passage.contentLatex, passage.contentText)}</MathText>
                    </div>
                  </li>
                ))}
              </ul>
            </SheetBody>
          </Sheet>
        </div>
      )}
    </>
  );
}
