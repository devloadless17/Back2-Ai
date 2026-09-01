import type { Metadata } from 'next';

import { GradeLog, type GradeEntry } from '@/components/settings/grade-log';
import { Alert } from '@/components/ui/feedback';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { listSubjects } from '@/lib/queries/taxonomy';

export const metadata: Metadata = { title: 'My grades' };

export default async function GradesSettingsPage() {
  const user = await requireUser();
  const { t } = await getTranslations();

  const [grades, subjects] = await Promise.all([
    db.userGrade.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        label: true,
        grade: true,
        maxGrade: true,
        date: true,
        subject: { select: { id: true, name: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
    listSubjects(user.trackId, user.preferredLanguage),
  ]);

  const entries: GradeEntry[] = grades.map((grade) => ({
    id: grade.id,
    label: grade.label,
    grade: grade.grade === null ? null : Number(grade.grade),
    maxGrade: grade.maxGrade === null ? null : Number(grade.maxGrade),
    date: grade.date ? grade.date.toISOString().slice(0, 10) : null,
    subjectName: grade.subject?.name ?? null,
  }));

  return (
    <div className="space-y-5">
      <Alert tone="info">{t.settings.gradesSubtitle}</Alert>
      <GradeLog grades={entries} subjects={subjects.map((s) => ({ id: s.id, name: s.name }))} />
    </div>
  );
}
