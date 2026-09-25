'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { AdminSubjectOption } from '@/components/admin/chapter-manager';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

export type AdminExamCycle = {
  id: string;
  year: number;
  session: string | null;
  title: string;
  durationMinutes: number;
  /** False means nobody has said: the sitting runs on the standard length. */
  durationIsOfficial: boolean;
  questionCount: number;
  sittingCount: number;
};

/** The lengths Lebanese Bac papers are actually set at. */
const COMMON_MINUTES = [60, 90, 120, 150, 180, 210, 240];

/**
 * How long each paper is sat for.
 *
 * THE DISTINCTION THE SCREEN IS ABOUT is official against fallback, not the
 * number. Every cycle shows 180 minutes whether or not anybody has ever looked
 * at the paper, so a list of durations alone would read as though the work were
 * done. The badge is the point: it says which of these the app is currently
 * guessing, and that is what an admin is here to reduce.
 *
 * CLEARING IS A REAL ACTION, not an empty field. Handing a cycle back to the
 * standard length is how a wrong entry is undone, and it has to be
 * distinguishable from typing 180 and meaning it — otherwise the one paper that
 * genuinely runs three hours is indistinguishable from the 1,655 nobody has
 * checked.
 *
 * The counts are shown because they are what the decision is about. Changing
 * the length of a paper students have already sat does not rewrite their
 * sittings, and the admin gets no second chance to notice that.
 */
export function ExamTimingManager({
  cycles,
  subjects,
  subjectId,
}: {
  cycles: AdminExamCycle[];
  subjects: AdminSubjectOption[];
  subjectId: string;
}) {
  const { t } = useI18n();
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function save(cycle: AdminExamCycle, minutes: number | null) {
    setError(null);
    setBusy(cycle.id);
    try {
      await sendJson('/api/admin/exam-cycles', 'PATCH', {
        examCycleId: cycle.id,
        durationMinutes: minutes,
      });
      setDrafts((d) => {
        const next = { ...d };
        delete next[cycle.id];
        return next;
      });
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    } finally {
      setBusy(null);
    }
  }

  const official = cycles.filter((c) => c.durationIsOfficial).length;

  return (
    <Sheet>
      <SheetHeader
        title={t.admin.examTiming}
        description={
          subjectId
            ? t.admin.examTimingOfficialCount
                .replace('{official}', String(official))
                .replace('{total}', String(cycles.length))
            : t.admin.examTimingPickSubject
        }
      />

      <SheetBody className="p-0">
        <div className="px-5 py-4">
          {/* A plain GET form: the chosen subject is the URL, so an admin can
              come back to the same list or send it to somebody. */}
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="block min-w-60 flex-1">
              <span className="text-caption font-medium text-ink">{t.admin.targetSubject}</span>
              <Select name="subject" defaultValue={subjectId} className="mt-1">
                <option value="">{t.admin.examTimingPickSubject}</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" variant="secondary" size="sm">
              {t.common.search}
            </Button>
          </form>
        </div>

        {error ? (
          <div className="px-5 pb-4">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}

        {subjectId && cycles.length === 0 ? (
          <EmptyState title={t.admin.examTimingNone} />
        ) : null}

        <ul className="divide-y divide-rule">
          {cycles.map((cycle) => {
            const draft = drafts[cycle.id] ?? String(cycle.durationMinutes);
            const parsed = Number(draft);
            const valid = Number.isInteger(parsed) && parsed >= 15 && parsed <= 240;
            const changed =
              parsed !== cycle.durationMinutes || !cycle.durationIsOfficial;

            return (
              <li key={cycle.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
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
                    ? t.admin.examTimingOfficial
                    : t.admin.examTimingFallback}
                </Badge>

                <label className="flex items-center gap-2">
                  <span className="sr-only">{t.admin.examTimingMinutes}</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={15}
                    max={240}
                    step={5}
                    list="bac-common-durations"
                    value={draft}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [cycle.id]: e.target.value }))
                    }
                    className="w-24"
                    aria-invalid={!valid}
                  />
                  <span className="text-caption text-ink-muted">
                    {t.admin.examTimingMinutes}
                  </span>
                </label>

                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy === cycle.id || !valid || !changed}
                  onClick={() => save(cycle, parsed)}
                >
                  {t.common.save}
                </Button>

                <Button
                  type="button"
                  variant="quiet"
                  disabled={busy === cycle.id || !cycle.durationIsOfficial}
                  onClick={() => save(cycle, null)}
                >
                  {t.admin.examTimingClear}
                </Button>
              </li>
            );
          })}
        </ul>

        <datalist id="bac-common-durations">
          {COMMON_MINUTES.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </SheetBody>
    </Sheet>
  );
}
