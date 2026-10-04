import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { EmptyAction, EmptyState } from '@/components/ui/feedback';
import { TutorAnchor } from '@/components/chat/tutor-context';
import { SubjectHub } from '@/components/practice/subject-hub';
import { ChapterPicker } from '@/components/practice/chapter-picker';
import { BackLink } from '@/components/ui/back-link';
import { getSubjectHub } from '@/lib/queries/subject-hub';
import { requireUser } from '@/lib/auth/guards';
import { chapterHasQuestions, chapterState } from '@/lib/curriculum';
import { getTranslations } from '@/lib/i18n';
import { getSubjectForTrack, listChapters } from '@/lib/queries/taxonomy';

export const metadata: Metadata = { title: 'Practice' };

/**
 * Chapters of one subject, grouped by unit and in syllabus order.
 *
 * Order is the syllabus order, not weakest-first. Students navigate by where
 * they are in the year; a list that reshuffles itself as their mastery changes
 * is a list they can never learn the shape of. The weakest chapter is surfaced
 * separately, on the dashboard, where it is the point.
 */
export default async function SubjectChaptersPage({
  params,
}: {
  params: Promise<{ subjectId: string }>;
}) {
  const { subjectId } = await params;
  const user = await requireUser();
  const { t } = await getTranslations();


  const subject = await getSubjectForTrack(subjectId, user.trackId);
  if (!subject) notFound();

  const [chapters, hub] = await Promise.all([
    listChapters(subject.id, user.id),
    getSubjectHub(subject.id, user.id, user.preferredLanguage),
  ]);


  return (
    <>
      {/*
        What a student can do in this subject, before the list of what is in it.

        The chapter list is still here and unchanged — it is the index, and an
        index belongs under the things it indexes rather than in place of them.
      */}
      {/* So the tutor knows which subject the student is standing in. */}
      <TutorAnchor label={subject.name} subjectId={subject.id} />
      {/*
        Up to the dashboard, not across to the subject list.
        
        `/practice` is the subject index, and it is the parent by URL and the
        wrong answer by use. A student reaches a subject hub from the dashboard,
        from a next-move card, from a chapter, or from a link a classmate sent,
        and the one place they always mean by "out of here" is the top. The
        subject list is a picker they passed through once, not somewhere to
        return to.
      */}
      <BackLink href="/dashboard" label={t.nav.dashboard} />

      <SubjectHub subjectId={subject.id} subjectName={subject.name} counts={hub} />

      <div id="chapters" className="mt-2">
        {chapters.length === 0 ? (
          <EmptyState
            tone="pending"
            title={t.practice.noQuestions}
            body={t.practice.emptyNothing.replace('{subject}', subject.name)}
            action={<EmptyAction href="/practice" label={t.practice.noPapersCta} />}
          />
        ) : (
          /*
           * One dropdown, not every chapter listed down the page (2026-10-04).
           * It opens on the chapter most worth doing: the weakest one already
           * started, else the first with questions.
           */
          <ChapterPicker
            subjectId={subject.id}
            initialId={
              [...chapters]
                .filter((c) => c.attemptsCount > 0 && chapterHasQuestions(chapterState(c)))
                .sort((a, b) => a.masteryScore - b.masteryScore)[0]?.id ?? null
            }
            chapters={chapters.map((chapter) => {
              const state = chapterState(chapter);
              return {
                id: chapter.id,
                name: chapter.name,
                unitName: chapter.unitName ?? null,
                questionCount: chapter.questionCount,
                attemptsCount: chapter.attemptsCount,
                masteryScore: chapter.masteryScore,
                openable: chapterHasQuestions(state) || state === 'readingOnly',
              };
            })}
          />
        )}
      </div>
    </>
  );
}
