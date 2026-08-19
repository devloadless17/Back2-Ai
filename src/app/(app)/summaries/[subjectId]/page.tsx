import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge, EmptyState } from '@/components/ui/feedback';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
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
      _count: { select: { questions: true, contentChunks: true } },
    },
    orderBy: { orderIndex: 'asc' },
  });

  const readable = chapters.filter((chapter) => chapter._count.contentChunks > 0);

  const byUnit = new Map<string, typeof readable>();
  for (const chapter of readable) {
    const unit = chapter.unit?.name ?? '';
    byUnit.set(unit, [...(byUnit.get(unit) ?? []), chapter]);
  }

  return (
    <>
      <PageHeader title={subject.name} description={t.summaries.subtitle} />

      <Link
        href="/summaries"
        className="mb-5 inline-block text-[13px] text-ink-faint underline-offset-2 hover:underline"
      >
        ← {t.nav.summaries}
      </Link>

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
                          <p className="text-[12px] text-ink-faint">
                            {chapter._count.questions > 0
                              ? format(t.summaries.pastQuestions, { count: chapter._count.questions })
                              : t.summaries.noPastQuestions}
                          </p>
                        </div>
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
