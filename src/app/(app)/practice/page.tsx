import type { Metadata } from 'next';
import Link from 'next/link';

import { SubjectRings, type SubjectRing } from '@/components/dashboard/subject-rings';
import { EmptyAction, EmptyState } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { getTranslations } from '@/lib/i18n';
import { getProgressForUser } from '@/lib/queries/progress';
import { listSubjects } from '@/lib/queries/taxonomy';

export const metadata: Metadata = { title: 'Practice' };

/**
 * Subject picker.
 *
 * Each subject shows the student's own mean mastery rather than a generic
 * "12 chapters" — the question this screen answers is "where should I go?", and
 * a count of chapters does not answer it.
 */
export default async function PracticePage() {
  const user = await requireUser();
  const { t } = await getTranslations();

  const [subjects, progress] = await Promise.all([
    listSubjects(user.trackId, user.preferredLanguage),
    getProgressForUser(user.id, user.trackId, user.preferredLanguage),
  ]);

  // Same ring card as the dashboard, from the same component — this screen and
  // that panel answer the same question ("which subject is behind?") and a
  // student should not have to read two different instruments for it.
  const byId = new Map(progress.map((subject) => [subject.subjectId, subject]));

  const rings: SubjectRing[] = subjects.map((subject) => {
    const chapters = byId.get(subject.id)?.chapters ?? [];
    return {
      subjectId: subject.id,
      subjectName: subject.name,
      mastery:
        chapters.length === 0
          ? 0
          : chapters.reduce((sum, c) => sum + c.masteryScore, 0) / chapters.length,
      mark: null,
      attemptsCount: chapters.reduce((sum, c) => sum + c.attemptsCount, 0),
      questionCount: subject.questionCount,
      chapterCount: subject.chapterCount,
    };
  });

  return (
    <>
      <PageHeader title={t.practice.title} description={t.practice.subtitle} />

      {subjects.length === 0 ? (
        <EmptyState
          tone="pending"
          title={t.practice.noSubjectsTitle}
          body={t.practice.noSubjectsBody}
          action={<EmptyAction href="/settings/profile" label={t.practice.noSubjectsCta} />}
        />
      ) : (
        <SubjectRings subjects={rings} size="lg" />
      )}
    </>
  );
}
