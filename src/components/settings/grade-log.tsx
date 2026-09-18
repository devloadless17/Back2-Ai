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
  subjectId: string | null;
  subjectName: string | null;
};

type SubjectOption = { id: string; name: string };

/**
 * The fields of one mark, shared by the add form and the inline edit form.
 *
 * Written once because the two must not drift: the day the edit form stops
 * offering a date, a student correcting a typo silently loses the date they
 * filed the mark under.
 */
function GradeFields({
  subjects,
  entry,
  idPrefix,
}: {
  subjects: SubjectOption[];
  /** Prefills for an edit. Absent means a blank add form. */
  entry?: GradeEntry;
  /** Keeps the generated input ids unique when several forms are on screen. */
  idPrefix: string;
}) {
  const { t } = useI18n();

  return (
    <>
      <Field label={t.settings.gradeLabel}>
        {({ id }) => (
          <Input
            id={`${idPrefix}-${id}`}
            name="label"
            maxLength={120}
            defaultValue={entry?.label ?? ''}
          />
        )}
      </Field>

      <Field label={t.admin.targetSubject}>
        {({ id }) => (
          <Select id={`${idPrefix}-${id}`} name="subjectId" defaultValue={entry?.subjectId ?? ''}>
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
            <Input
              id={`${idPrefix}-${id}`}
              name="grade"
              type="number"
              step="0.25"
              min="0"
              required
              defaultValue={entry?.grade ?? ''}
            />
          )}
        </Field>
        <Field label={t.settings.gradeMax} required>
          {({ id }) => (
            <Input
              id={`${idPrefix}-${id}`}
              name="maxGrade"
              type="number"
              step="1"
              min="1"
              required
              defaultValue={entry?.maxGrade ?? 20}
            />
          )}
        </Field>
      </div>

      <Field label={t.settings.gradeDate}>
        {({ id }) => (
          <Input
            id={`${idPrefix}-${id}`}
            name="date"
            type="date"
            defaultValue={entry?.date ?? ''}
          />
        )}
      </Field>
    </>
  );
}

/**
 * Private grade log.
 *
 * Each row shows its own proportion as a bar so the log reads at a glance —
 * 14/20 and 7/10 are the same result and a column of raw numbers hides that.
 * Nothing here feeds mastery or readiness, which the page says out loud.
 *
 * EDITING HAPPENS IN THE ROW, not in the panel on the right. A student on a
 * phone has the list under their thumb and the panel a scroll away, and an edit
 * that moves the answer off screen is one they cannot check against what they
 * are correcting. Delete-and-retype was the only route before this; it worked,
 * and it threw away the row's date every time.
 */
export function GradeLog({
  grades,
  subjects,
}: {
  grades: GradeEntry[];
  subjects: SubjectOption[];
}) {
  const { t, formatScore, formatDate } = useI18n();
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  /** The numbers off a grade form, or null when they do not describe a mark. */
  function readForm(form: HTMLFormElement) {
    const data = new FormData(form);
    const grade = Number(data.get('grade'));
    const maxGrade = Number(data.get('maxGrade'));

    if (!Number.isFinite(grade) || !Number.isFinite(maxGrade) || maxGrade <= 0) return null;
    if (grade > maxGrade) return null;

    return {
      label: String(data.get('label') ?? '') || null,
      subjectId: String(data.get('subjectId') ?? '') || null,
      grade,
      maxGrade,
      date: String(data.get('date') ?? '') || null,
    };
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = event.currentTarget;
    const payload = readForm(form);
    if (!payload) {
      setError(t.settings.gradeInvalid);
      return;
    }

    setSaving(true);
    try {
      await sendJson('/api/grades', 'POST', payload);
      form.reset();
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    } finally {
      setSaving(false);
    }
  }

  async function save(id: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const payload = readForm(event.currentTarget);
    if (!payload) {
      setError(t.settings.gradeInvalid);
      return;
    }

    setSaving(true);
    try {
      await sendJson('/api/grades', 'PATCH', { id, ...payload });
      setEditing(null);
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
      if (editing === id) setEditing(null);
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

                if (editing === entry.id) {
                  return (
                    <li key={entry.id} className="bg-paper-sunken px-5 py-4">
                      <form onSubmit={(event) => save(entry.id, event)} className="space-y-3">
                        <GradeFields
                          subjects={subjects}
                          entry={entry}
                          idPrefix={`edit-${entry.id}`}
                        />

                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            variant="quiet"
                            size="sm"
                            onClick={() => {
                              setEditing(null);
                              setError(null);
                            }}
                          >
                            {t.common.cancel}
                          </Button>
                          <Button type="submit" variant="primary" size="sm" loading={saving}>
                            {t.common.save}
                          </Button>
                        </div>
                      </form>
                    </li>
                  );
                }

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
                          onClick={() => {
                            setEditing(entry.id);
                            setError(null);
                          }}
                          className="text-caption text-ink-faint transition-colors hover:text-primary"
                        >
                          {t.common.edit}
                        </button>
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
            <GradeFields subjects={subjects} idPrefix="add" />
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
