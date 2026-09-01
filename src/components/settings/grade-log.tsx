'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { Meter } from '@/components/ui/progress';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

export type GradeEntry = {
  id: string;
  label: string | null;
  grade: number | null;
  maxGrade: number | null;
  date: string | null;
  subjectName: string | null;
};

/**
 * Private grade log.
 *
 * Each row shows its own proportion as a bar so the log reads at a glance —
 * 14/20 and 7/10 are the same result and a column of raw numbers hides that.
 * Nothing here feeds mastery or readiness, which the page says out loud.
 */
export function GradeLog({
  grades,
  subjects,
}: {
  grades: GradeEntry[];
  subjects: { id: string; name: string }[];
}) {
  const { t, formatScore, formatDate } = useI18n();
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    const form = new FormData(event.currentTarget);
    const grade = Number(form.get('grade'));
    const maxGrade = Number(form.get('maxGrade'));

    if (!Number.isFinite(grade) || !Number.isFinite(maxGrade) || maxGrade <= 0 || grade > maxGrade) {
      setError(t.common.unknownError);
      setSaving(false);
      return;
    }

    try {
      await sendJson('/api/grades', 'POST', {
        label: String(form.get('label') ?? '') || null,
        subjectId: String(form.get('subjectId') ?? '') || null,
        grade,
        maxGrade,
        date: String(form.get('date') ?? '') || null,
      });
      event.currentTarget.reset();
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await sendJson('/api/grades', 'DELETE', { id });
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Sheet>
        <SheetHeader title={t.settings.grades} />
        <SheetBody className="p-0">
          {error && (
            <div className="px-5 pt-4">
              <Alert tone="error">{error}</Alert>
            </div>
          )}

          {grades.length === 0 ? (
            <EmptyState
              tone="neutral"
              title={t.settings.gradesEmpty}
              body={t.settings.gradesEmptyHint}
              className="m-4 border-0 bg-transparent"
            />
          ) : (
            <ul className="ruled">
              {grades.map((entry) => {
                const ratio =
                  entry.grade !== null && entry.maxGrade ? entry.grade / entry.maxGrade : 0;

                return (
                  <li key={entry.id} className="px-5 py-3">
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {entry.label ?? entry.subjectName ?? '—'}
                        </p>
                        <p className="text-caption text-ink-faint">
                          {[entry.subjectName, entry.date ? formatDate(entry.date) : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-baseline gap-3">
                        <p className="text-lg font-semibold tabular-nums">
                          {entry.grade === null ? '—' : formatScore(entry.grade)}
                          <span className="text-meta font-normal text-ink-faint">
                            {' / '}
                            {entry.maxGrade === null ? '—' : formatScore(entry.maxGrade)}
                          </span>
                        </p>
                        <button
                          type="button"
                          onClick={() => remove(entry.id)}
                          className="text-caption text-ink-faint transition-colors hover:text-mark"
                        >
                          {t.common.delete}
                        </button>
                      </div>
                    </div>

                    <Meter value={ratio} size="sm" />
                  </li>
                );
              })}
            </ul>
          )}
        </SheetBody>
      </Sheet>

      <Sheet className="h-fit">
        <SheetHeader title={t.settings.addGrade} />
        <form onSubmit={add}>
          <SheetBody className="space-y-3">
            <Field label={t.settings.gradeLabel}>
              {({ id }) => <Input id={id} name="label" maxLength={120} />}
            </Field>

            <Field label={t.admin.targetSubject}>
              {({ id }) => (
                <Select id={id} name="subjectId">
                  <option value="">{t.admin.allSubjects}</option>
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t.settings.gradeValue} required>
                {({ id }) => (
                  <Input id={id} name="grade" type="number" step="0.25" min="0" required />
                )}
              </Field>
              <Field label={t.settings.gradeMax} required>
                {({ id }) => (
                  <Input id={id} name="maxGrade" type="number" step="1" min="1" defaultValue={20} required />
                )}
              </Field>
            </div>

            <Field label={t.settings.gradeDate}>
              {({ id }) => <Input id={id} name="date" type="date" />}
            </Field>
          </SheetBody>

          <SheetFooter className="justify-end">
            <Button type="submit" variant="primary" size="sm" loading={saving}>
              {t.common.save}
            </Button>
          </SheetFooter>
        </form>
      </Sheet>
    </div>
  );
}
