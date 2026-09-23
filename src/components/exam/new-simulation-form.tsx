'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Alert, EmptyAction, EmptyState } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { ApiRequestError, sendJson } from '@/lib/client/request';
import { formatDuration } from '@/lib/exam-duration';
import { useI18n } from '@/lib/i18n/client';

export type SimulationOption = {
  subjectId: string;
  subjectName: string;
  cycles: {
    id: string;
    label: string;
    questionCount: number;
    durationMinutes: number;
    /** Whether the duration came off the paper or is our fallback. */
    durationIsOfficial: boolean;
  }[];
  /** Real past-exam questions available to assemble a mock paper from. */
  realPoolCount: number;
  generatedAvailable: number;
};

/**
 * Choosing a paper.
 *
 * The warning before "Begin" is not boilerplate: the timer starts on the
 * server the instant this posts, and closing the tab does not pause it. A
 * student who did not understand that would learn it by losing a paper.
 */
export function NewSimulationForm({
  options,
  initialSubjectId,
  initialCycleId,
}: {
  options: SimulationOption[];
  /**
   * The subject the student arrived from.
   *
   * Reaching this page from inside a subject and being asked which subject you
   * meant is the navigation losing what it already knew. Ignored when it names
   * a subject this student cannot sit — a hand-edited URL should fall back to
   * the first option, not render a form with nothing selected.
   */
  initialSubjectId?: string;
  /** Preselects a paper, for the link from a past paper. */
  initialCycleId?: string;
}) {
  const { t, format } = useI18n();
  const router = useRouter();

  const start =
    /*
     * A `?cycle=` from a past paper decides the subject too — the student
     * asked for that specific paper, and landing them on a different subject's
     * default would quietly ignore what they clicked.
     */
    options.find((option) =>
      initialCycleId
        ? option.cycles.some((cycle) => cycle.id === initialCycleId)
        : option.subjectId === initialSubjectId,
    ) ??
    options.find((option) => option.subjectId === initialSubjectId) ??
    options[0];

  const [subjectId, setSubjectId] = useState(start?.subjectId ?? '');
  const [mode, setMode] = useState<'real_cycle' | 'ai_generated' | 'real_mixed'>('real_cycle');
  const [cycleId, setCycleId] = useState(
    (initialCycleId && start?.cycles.some((cycle) => cycle.id === initialCycleId)
      ? initialCycleId
      : start?.cycles[0]?.id) ?? '',
  );
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subject = options.find((option) => option.subjectId === subjectId);
  const selectedCycle = subject?.cycles.find((cycle) => cycle.id === cycleId);
  const canUseReal = (subject?.cycles.length ?? 0) > 0;
  /* Five is the paper size; below that there is nothing to assemble. */
  const canUseMixed = (subject?.realPoolCount ?? 0) >= 5;
  const canUseGenerated = (subject?.generatedAvailable ?? 0) > 0;

  async function begin() {
    if (!subjectId) return;
    setStarting(true);
    setError(null);

    try {
      const simulation = await sendJson<{ id: string }>('/api/exam-sim', 'POST', {
        subjectId,
        sourceMode: mode,
        ...(mode === 'real_cycle' ? { examCycleId: cycleId } : {}),
      });
      router.push(`/exam-sim/${simulation.id}`);
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.code === 'NO_CONTENT'
          ? t.practice.simNotEnough
          : err instanceof ApiRequestError && err.code === 'IN_PROGRESS_EXISTS'
            ? t.examSim.inProgressNotice
            : t.common.unknownError,
      );
      setStarting(false);
    }
  }

  if (options.length === 0) {
    return (
      <EmptyState
        tone="pending"
        title={t.practice.simNoneTitle}
        body={t.practice.simNoneBody}
        action={<EmptyAction href="/practice" label={t.practice.simNoneCta} />}
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Sheet>
        <SheetHeader title={t.examSim.chooseSubject} />
        <SheetBody>
          <Select
            value={subjectId}
            onChange={(event) => {
              const next = event.target.value;
              setSubjectId(next);
              const nextSubject = options.find((option) => option.subjectId === next);
              setCycleId(nextSubject?.cycles[0]?.id ?? '');
              if ((nextSubject?.cycles.length ?? 0) === 0) setMode('ai_generated');
            }}
            aria-label={t.examSim.chooseSubject}
          >
            {options.map((option) => (
              <option key={option.subjectId} value={option.subjectId}>
                {option.subjectName}
              </option>
            ))}
          </Select>
        </SheetBody>
      </Sheet>

      <Sheet>
        <SheetHeader title={t.examSim.chooseMode} />
        <SheetBody className="space-y-3">
          <ModeCard
            selected={mode === 'real_cycle'}
            disabled={!canUseReal}
            onSelect={() => setMode('real_cycle')}
            title={t.examSim.modeRealCycle}
            hint={canUseReal ? t.examSim.modeRealCycleHint : t.oldCycles.noCycles}
          />
          {/*
            A mock paper from real questions.

            Listed second, above the generated mode, because it is the better
            answer for most students most of the time: the questions are real
            Bac questions with real barèmes, nothing waits on a review queue,
            and unlike a past paper it can be sat more than once.
          */}
          <ModeCard
            selected={mode === 'real_mixed'}
            disabled={!canUseMixed}
            onSelect={() => setMode('real_mixed')}
            title={t.examSim.modeRealMixed}
            hint={
              canUseMixed
                ? format(t.examSim.modeRealMixedHint, { count: subject?.realPoolCount ?? 0 })
                : t.examSim.modeRealMixedEmpty
            }
          />
          <ModeCard
            selected={mode === 'ai_generated'}
            disabled={!canUseGenerated}
            onSelect={() => setMode('ai_generated')}
            title={t.examSim.modeAiGenerated}
            hint={
              canUseGenerated
                ? t.examSim.modeAiGeneratedHint
                : t.admin.queueEmptyHint
            }
          />

          {mode === 'real_cycle' && canUseReal && (
            <div className="pt-1">
              <label className="mb-1.5 block text-meta font-medium text-ink">
                {t.examSim.chooseCycle}
              </label>
              <Select value={cycleId} onChange={(event) => setCycleId(event.target.value)}>
                {subject?.cycles.map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    {cycle.label} · {format(t.oldCycles.questionCount, { count: cycle.questionCount })}
                  </option>
                ))}
              </Select>

              {/* How long it runs, and where that number came from. The second
                  half is the point: a clock nobody recorded must not be
                  presented as the paper's own, and "exactly as it was sat" is
                  a claim about time as much as about content. */}
              {selectedCycle && (
                <p className="mt-1.5 text-meta leading-snug text-ink-muted">
                  {t.examSim.duration}
                  {': '}
                  {formatDuration(selectedCycle.durationMinutes, {
                    hours: t.examSim.durationHours,
                    hoursMinutes: t.examSim.durationHoursMinutes,
                    minutesOnly: t.examSim.durationMinutesOnly,
                  })}
                  {' · '}
                  {selectedCycle.durationIsOfficial
                    ? t.examSim.durationOfficial
                    : t.examSim.durationStandard}
                </p>
              )}
            </div>
          )}
        </SheetBody>
      </Sheet>

      {error && <Alert tone="error">{error}</Alert>}

      <Sheet>
        <SheetBody>
          <Alert tone="warning">{t.examSim.beginWarning}</Alert>
        </SheetBody>
        <SheetFooter className="justify-end">
          <Button
            variant="mark"
            size="lg"
            onClick={begin}
            loading={starting}
            /*
             * Three modes, three gates. This used to read
             * `mode === 'real_cycle' ? … : !canUseGenerated` — written when
             * there were only two modes, and never updated when `real_mixed`
             * was added as a third. `real_mixed` fell into the `else` branch
             * and was gated on `canUseGenerated` instead of `canUseMixed`, so
             * "Begin" stayed disabled for a mock exam whenever the unrelated
             * AI-generated queue was empty — which is effectively always.
             */
            disabled={
              mode === 'real_cycle'
                ? !canUseReal || !cycleId
                : mode === 'real_mixed'
                  ? !canUseMixed
                  : !canUseGenerated
            }
          >
            {t.examSim.begin}
          </Button>
        </SheetFooter>
      </Sheet>
    </div>
  );
}

function ModeCard({
  selected,
  disabled,
  onSelect,
  title,
  hint,
}: {
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'w-full rounded border px-4 py-3 text-start transition-colors duration-150',
        selected && !disabled
          ? 'border-primary bg-primary-soft'
          : 'border-rule-strong bg-paper-raised hover:bg-paper-sunken',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-paper-raised',
      )}
    >
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-0.5 text-meta leading-snug text-ink-muted">{hint}</p>
    </button>
  );
}
