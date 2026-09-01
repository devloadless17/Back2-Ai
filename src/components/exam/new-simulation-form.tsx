'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Alert, EmptyAction, EmptyState } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { ApiRequestError, sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

export type SimulationOption = {
  subjectId: string;
  subjectName: string;
  cycles: { id: string; label: string; questionCount: number; durationMinutes: number }[];
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
export function NewSimulationForm({ options }: { options: SimulationOption[] }) {
  const { t, format } = useI18n();
  const router = useRouter();

  const [subjectId, setSubjectId] = useState(options[0]?.subjectId ?? '');
  const [mode, setMode] = useState<'real_cycle' | 'ai_generated' | 'real_mixed'>('real_cycle');
  const [cycleId, setCycleId] = useState(options[0]?.cycles[0]?.id ?? '');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subject = options.find((option) => option.subjectId === subjectId);
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
            disabled={mode === 'real_cycle' ? !canUseReal || !cycleId : !canUseGenerated}
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
