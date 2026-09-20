import type { Metadata } from 'next';

import { ChapterManager, type AdminChapter } from '@/components/admin/chapter-manager';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';

export const metadata: Metadata = { title: 'Chapters' };

/**
 * The chapter list an administrator can cancel from.
 *
 * SCOPED TO ONE SUBJECT, by a plain GET form. There are ~1,193 chapters across
 * the four tracks and no screen should offer them all at once: cancelling is a
 * decision made a subject at a time, when the ministry publishes a reduced
 * programme for that subject. Keeping the choice in the URL means an admin can
 * return to the same list, or send it to whoever is checking the cut.
 *
 * Unlike every student-facing chapter query, this one deliberately does NOT
 * filter cancelled chapters out — this is the only screen from which they can
 * be put back.
 */
export default async function AdminChaptersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const raw = params.subject;
  const subjectId = (Array.isArray(raw) ? raw[0] : raw) ?? '';

  const subjects = await db.subject.findMany({
    select: { id: true, name: true, track: { select: { code: true } } },
    orderBy: [{ track: { code: 'asc' } }, { name: 'asc' }],
  });

  const chapters = subjectId
    ? await db.chapter.findMany({
        where: { subjectId },
        select: {
          id: true,
          name: true,
          subjectId: true,
          cancelledAt: true,
          cancelledReason: true,
          unit: { select: { name: true } },
          subject: { select: { name: true, language: true, track: { select: { code: true } } } },
          /*
           * What is behind the chapter, so the decision is made with it in
           * view. `alsoHasQuestions` rather than a plain question count: that
           * is the set practice actually serves from, and the two differ by
           * three to five times on this corpus.
           */
          _count: {
            select: {
              alsoHasQuestions: { where: { question: { verifiedStatus: { not: 'rejected' } } } },
              attempts: true,
            },
          },
        },
        orderBy: { orderIndex: 'asc' },
      })
    : [];

  const rows: AdminChapter[] = chapters.map((chapter) => ({
    id: chapter.id,
    name: chapter.name,
    subjectId: chapter.subjectId,
    subjectName: chapter.subject.name,
    trackCode: chapter.subject.track?.code ?? null,
    language: String(chapter.subject.language),
    unitName: chapter.unit?.name ?? null,
    questionCount: chapter._count.alsoHasQuestions,
    attemptCount: chapter._count.attempts,
    cancelledAt: chapter.cancelledAt?.toISOString() ?? null,
    cancelledReason: chapter.cancelledReason,
  }));

  return (
    <ChapterManager
      chapters={rows}
      subjects={subjects.map((s) => ({
        id: s.id,
        label: `${s.track?.code ?? '—'} · ${s.name}`,
      }))}
      subjectId={subjectId}
    />
  );
}
