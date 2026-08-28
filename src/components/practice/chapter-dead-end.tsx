import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';

/**
 * What a student is offered when a chapter has no questions.
 *
 * This screen is not rare. 74% of chapters hold fewer than five questions and
 * 45% hold none at all, so "I opened the chapter I am studying and there was
 * nothing" is one of the most common experiences the product delivers. It used
 * to be answered with "Once the curriculum for this chapter is ingested,
 * questions will appear here" — the pipeline's vocabulary, in the pipeline's
 * voice, offering nothing.
 *
 * The material is usually there. `Motor activity` has no questions and NINETEEN
 * passages of its own textbook, and its subject holds 136 questions in other
 * chapters. An assistant that says "come back later" while sitting on all of
 * that is not assisting; it is filing a defect report to a seventeen-year-old.
 *
 * So the dead end offers what actually exists, in order of how close it is to
 * what the student came for:
 *
 *   read this chapter    when passages exist — it is the same material the
 *                        questions would have been drawn from
 *   ask about it         the tutor grounds on those same passages, so a chapter
 *                        with material can be asked about even with no questions
 *   practise elsewhere   the nearest chapter in the subject that does have
 *                        questions, named, so the offer is a destination rather
 *                        than a suggestion to go and look
 *
 * When none of the three exists the copy says so plainly and stops. A dead end
 * honestly named is better than an offer that leads to another empty screen.
 */
export async function ChapterDeadEnd({
  chapterId,
  subjectId,
  subjectName,
}: {
  chapterId: string;
  subjectId: string;
  subjectName: string;
}) {
  const { t } = await getTranslations();

  const [passages, sibling] = await Promise.all([
    db.chapterContentChunk.count({ where: { chapterId } }),
    /*
     * The nearest sibling that can actually be practised. Ordered by position in
     * the book rather than by question count: a student working through a
     * syllabus wants the next thing, not the busiest thing.
     */
    db.chapter.findFirst({
      where: {
        subjectId,
        id: { not: chapterId },
        questions: { some: { verifiedStatus: { not: 'rejected' } } },
      },
      select: { id: true, name: true },
      orderBy: { orderIndex: 'asc' },
    }),
  ]);

  const offers: { href: string; label: string; primary?: boolean }[] = [];
  if (passages > 0) {
    offers.push({
      href: `/summaries/${subjectId}/${chapterId}`,
      label: t.practice.emptyRead,
      primary: true,
    });
    offers.push({ href: '/chat', label: t.practice.emptyAsk });
  }
  if (sibling) {
    offers.push({
      href: `/practice/${subjectId}/${sibling.id}`,
      label: t.practice.emptyElsewhere.replace('{chapter}', sibling.name),
    });
  }

  if (offers.length === 0) {
    return (
      <EmptyState
        tone="pending"
        title={t.practice.noQuestions}
        body={t.practice.emptyNothing.replace('{subject}', subjectName)}
      />
    );
  }

  return (
    <EmptyState
      tone="pending"
      title={t.practice.noQuestions}
      body={passages > 0 ? t.practice.noQuestionsHint : undefined}
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          {offers.map((offer) => (
            <LinkButton
              key={offer.href}
              href={offer.href}
              variant={offer.primary ? 'primary' : 'secondary'}
              size="sm"
            >
              {offer.label}
            </LinkButton>
          ))}
        </div>
      }
    />
  );
}
