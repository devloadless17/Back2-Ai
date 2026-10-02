'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, LinkButton } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

export type AdminExamCycle = {
  id: string;
  year: number;
  session: string | null;
  title: string;
  durationMinutes: number;
  durationIsOfficial: boolean;
  questionCount: number;
  sittingCount: number;
};

export type TimingSubject = {
  id: string;
  label: string;
  track: string;
  name: string;
  examDurationMinutes: number | null;
  paperCount: number;
};

const COMMON_MINUTES = [60, 90, 120, 150, 180, 210, 240];
const MIN = 15;
const MAX = 300;

/**
 * Exam timing, set where it actually varies: per subject.
 *
 * Every GS Chemistry paper runs on the same clock, so the length is set once
 * on the subject and every paper of it uses that — including papers loaded
 * later. A paper keeps a length of its own only when it was genuinely sat
 * longer or shorter; that list is one click further down, per subject.
 */
export function ExamTimingManager({
  cycles,
  subjects,
  subjectId,
}: {
  cycles: AdminExamCycle[];
  subjects: TimingSubject[];
  subjectId: string;
}) {
  const { t } = useI18n();
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  function clearDraft(id: string) {
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
  }

  async function run(id: string, url: string, body: object) {
    setError(null);
    setBusy(id);
    try {
      await sendJson(url, 'PATCH', body);
      clearDraft(id);
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    } finally {
      setBusy(null);
    }
  }

  const chosen = subjects.find((s) => s.id === subjectId) ?? null;
  const set = subjects.filter((s) => s.examDurationMinutes !== null).length;

  return (
    <div className="space-y-6">
      <Sheet>
        <SheetHeader
          title={t.admin.examTimingSubjectsTitle}
          description={`${t.admin.examTimingSubjectsHint} (${set}/${subjects.length})`}
        />
        <SheetBody className="p-0">
          {error ? (
            <div className="px-5 pt-4">
              <Alert tone="error">{error}</Alert>
            </div>
          ) : null}

          <ul className="divide-y divide-rule">
            {subjects.map((subject) => {
              const current = subject.examDurationMinutes;
              const draft = drafts[subject.id] ?? (current === null ? '' : String(current));
              const parsed = Number(draft);
              const valid = draft !== '' && Number.isInteger(parsed) && parsed >= MIN && parsed <= MAX;
              const changed = valid && parsed !== current;

              return (
                <li
                  key={subject.id}
                  className={cn(
                    'flex flex-wrap items-center gap-3 px-5 py-3',
                    subject.id === subjectId && 'bg-primary-soft/40',
                  )}
                >
                  <div className="min-w-48 flex-1">
                    <p className="text-body font-medium text-ink">
                      <span className="me-2 text-caption font-semibold text-ink-faint">{subject.track}</span>
                      <bdi>{subject.name}</bdi>
                    </p>
                    {current === null && (
                      <p className="text-caption text-ink-faint">{t.admin.examTimingNotSet}</p>
                    )}
                  </div>

                  <label className="flex items-center gap-2">
                    <span className="sr-only">{t.admin.examTimingMinutes}</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={MIN}
                      max={MAX}
                      step={5}
                      list="bac-common-durations"
                      placeholder="—"
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [subject.id]: e.target.value }))}
                      className="w-24"
                    />
                    <span className="text-caption text-ink-muted">{t.admin.examTimingMinutes}</span>
                  </label>

                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy === subject.id || !changed}
                    onClick={() =>
                      run(subject.id, '/api/admin/subject-exam-duration', {
                        subjectId: subject.id,
                        durationMinutes: parsed,
                      })
                    }
                  >
                    {t.common.save}
                  </Button>

                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    disabled={busy === subject.id || current === null}
                    onClick={() =>
                      run(subject.id, '/api/admin/subject-exam-duration', {
                        subjectId: subject.id,
                        durationMinutes: null,
                      })
                    }
                  >
                    {t.admin.examTimingClear}
                  </Button>

                  {subject.paperCount > 0 && (
                    <LinkButton
                      href={`?subject=${subject.id}#papers`}
                      variant="quiet"
                      size="sm"
                    >
                      {t.admin.examTimingSeePapers} ({subject.paperCount})
                    </LinkButton>
                  )}
                </li>
              );
            })}
          </ul>
        </SheetBody>
      </Sheet>

      {chosen && (
        <Sheet id="papers">
          <SheetHeader
            title={t.admin.examTimingPapersTitle.replace('{subject}', chosen.label)}
            description={t.admin.examTimingPapersHint}
          />
          <SheetBody className="p-0">
            {cycles.length === 0 ? <EmptyState title={t.admin.examTimingNone} /> : null}

            <ul className="divide-y divide-rule">
              {cycles.map((cycle) => {
                // What this paper is sat on today: its own length, else the subject's.
                const effective = cycle.durationIsOfficial
                  ? cycle.durationMinutes
                  : (chosen.examDurationMinutes ?? cycle.durationMinutes);
                const draft = drafts[cycle.id] ?? String(effective);
                const parsed = Number(draft);
                const valid = Number.isInteger(parsed) && parsed >= MIN && parsed <= MAX;
                const changed = valid && (!cycle.durationIsOfficial || parsed !== cycle.durationMinutes);

                return (
                  <li key={cycle.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-48 flex-1">
                      <p className="text-body font-medium text-ink">
                        {cycle.year}
                        {cycle.session ? ` · ${cycle.session}` : ''}
                      </p>
                      <p className="text-caption text-ink-muted">
                        {t.admin.examTimingCounts
                          .replace('{questions}', String(cycle.questionCount))
                          .replace('{sittings}', String(cycle.sittingCount))}
                      </p>
                    </div>

                    <Badge tone={cycle.durationIsOfficial ? 'correct' : 'neutral'}>
                      {cycle.durationIsOfficial
                        ? t.admin.examTimingOwn
                        : chosen.examDurationMinutes !== null
                          ? t.admin.examTimingUsesSubject
                          : t.admin.examTimingFallback}
                    </Badge>

                    <label className="flex items-center gap-2">
                      <span className="sr-only">{t.admin.examTimingMinutes}</span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={MIN}
                        max={MAX}
                        step={5}
                        list="bac-common-durations"
                        value={draft}
                        onChange={(e) => setDrafts((d) => ({ ...d, [cycle.id]: e.target.value }))}
                        className="w-24"
                        aria-invalid={!valid}
                      />
                      <span className="text-caption text-ink-muted">{t.admin.examTimingMinutes}</span>
                    </label>

                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy === cycle.id || !changed}
                      onClick={() =>
                        run(cycle.id, '/api/admin/exam-cycles', {
                          examCycleId: cycle.id,
                          durationMinutes: parsed,
                        })
                      }
                    >
                      {t.common.save}
                    </Button>

                    <Button
                      type="button"
                      variant="quiet"
                      size="sm"
                      disabled={busy === cycle.id || !cycle.durationIsOfficial}
                      onClick={() =>
                        run(cycle.id, '/api/admin/exam-cycles', {
                          examCycleId: cycle.id,
                          durationMinutes: null,
                        })
                      }
                    >
                      {t.admin.examTimingUsesSubject}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </SheetBody>
        </Sheet>
      )}

      <datalist id="bac-common-durations">
        {COMMON_MINUTES.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </div>
  );
}
