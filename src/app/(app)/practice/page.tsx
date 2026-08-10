import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/ui/feedback';
import { Meter } from '@/components/ui/progress';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
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
    listSubjects(user.trackId),
    getProgressForUser(user.id, user.trackId),
  ]);

  const masteryBySubject = new Map(
    progress.map((subject) => [
      subject.subjectId,
      subject.chapters.length === 0
        ? 0
        : subject.chapters.reduce((sum, c) => sum + c.masteryScore, 0) / subject.chapters.length,
    ]),
  );

  return (
    <>
      <PageHeader title={t.practice.title} description={t.practice.subtitle} />

      {subjects.length === 0 ? (
        <EmptyState
          tone="pending"
          title={t.practice.noQuestions}
          body={t.practice.noQuestionsHint}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {subjects.map((subject) => (
            <Link
              key={subject.id}
              href={`/practice/${subject.id}`}
              className="group block rounded-lg outline-none transition-transform duration-150 ease-sheet focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
            >
              <Sheet className="h-full transition-shadow duration-200 ease-sheet group-hover:shadow-sheet-raised">
                <SheetHeader title={subject.name} description={t.practice.selectChapter} />
                <SheetBody className="space-y-3">
                  <Meter
                    value={masteryBySubject.get(subject.id) ?? 0}
                    label={t.practice.mastery}
                    caption={`${subject.chapterCount} · ${subject.questionCount}`}
                  />
                </SheetBody>
              </Sheet>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
