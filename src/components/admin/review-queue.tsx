'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { MathText } from '@/components/ui/math';
import { RuledRow, Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

export type ReviewItem = {
  id: string;
  itemType: 'generated_problem' | 'tagged_question' | 'flagged_content';
  flagReason: string | null;
  createdAt: string;
  flaggedBy: string | null;
  context: string | null;
  body: string | null;
  solution: string | null;
  finalAnswer: string | null;
  solverStatus: string | null;
  solverNotes: string | null;
  modelUsed: string | null;
  bareme: { criterion: string; points: number }[];
};

/**
 * Review queue.
 *
 * A `solver_failed` item is shown with a loud warning rather than being hidden
 * or auto-rejected: seeing what the generator gets wrong is how the prompt
 * improves, and a reviewer who can only see the successes has no way to tell
 * whether the pipeline is healthy.
 */
export function ReviewQueue({ items }: { items: ReviewItem[] }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  async function decide(id: string, decision: 'approve' | 'reject') {
    setBusy(id);
    setError(null);

    try {
      await sendJson('/api/admin/review-queue', 'POST', {
        id,
        decision,
        notes: notes[id]?.trim() || undefined,
      });
      setResolved((current) => new Set(current).add(id));
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    } finally {
      setBusy(null);
    }
  }

  const pending = items.filter((item) => !resolved.has(item.id));

  if (pending.length === 0) {
    return <EmptyState tone="positive" title={t.admin.queueEmpty} body={t.admin.queueEmptyHint} />;
  }

  return (
    <div className="space-y-5">
      {error && <Alert tone="error">{error}</Alert>}

      {pending.map((item) => (
        <Sheet key={item.id} className="animate-fade-up">
          <SheetHeader
            title={
              item.itemType === 'generated_problem'
                ? t.admin.itemType + ': ' + t.examSim.modeAiGenerated
                : item.itemType === 'tagged_question'
                  ? t.practice.question
                  : t.chat.title
            }
            description={[item.context, formatDate(item.createdAt)].filter(Boolean).join(' · ')}
            actions={
              <Badge tone={item.solverStatus === 'solver_failed' ? 'mark' : 'neutral'}>
                {item.flaggedBy ? `${t.admin.flaggedBy} ${item.flaggedBy}` : t.admin.systemFlagged}
              </Badge>
            }
          />

          {item.solverStatus === 'solver_failed' && (
            <SheetBody className="pb-0">
              <Alert tone="error" title={t.admin.reject}>
                {item.solverNotes ?? ''}
              </Alert>
            </SheetBody>
          )}

          {item.flagReason && (
            <SheetBody className="pb-0">
              <p className="whitespace-pre-wrap rounded border border-rule bg-paper-sunken px-3 py-2 text-[12.5px] leading-relaxed text-ink-muted">
                {item.flagReason}
              </p>
            </SheetBody>
          )}

          {item.body && (
            <SheetBody>
              <MathText>{item.body}</MathText>
            </SheetBody>
          )}

          {item.solution && (
            <>
              <SheetHeader title={t.practice.solution} className="border-t" />
              <SheetBody>
                <MathText>{item.solution}</MathText>
                {item.finalAnswer && (
                  <p className="mt-3 text-[13px] text-ink">
                    <span className="font-semibold">{t.examSim.awarded}: </span>
                    {item.finalAnswer}
                  </p>
                )}
              </SheetBody>
            </>
          )}

          {item.bareme.length > 0 && (
            <>
              <SheetHeader title={t.examSim.baremeBreakdown} className="border-t" />
              <SheetBody className="p-0">
                <div className="ruled">
                  {item.bareme.map((criterion, index) => (
                    <RuledRow key={index} className="justify-between">
                      <span className="min-w-0 text-[13.5px] text-ink">{criterion.criterion}</span>
                      <span className="shrink-0 tabular-nums text-[13px] font-semibold text-ink-muted">
                        {criterion.points}
                      </span>
                    </RuledRow>
                  ))}
                </div>
              </SheetBody>
            </>
          )}

          <SheetBody className="border-t border-rule">
            <Textarea
              value={notes[item.id] ?? ''}
              onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
              placeholder={t.admin.reviewNotes}
              rows={2}
              className="min-h-[4rem]"
            />
            {item.itemType === 'generated_problem' && (
              <p className="mt-2 text-[12.5px] text-ink-muted">{t.admin.publishNotice}</p>
            )}
            {item.modelUsed && (
              <p className="mt-1 text-[11.5px] text-ink-faint">{item.modelUsed}</p>
            )}
          </SheetBody>

          <SheetFooter className="justify-end">
            <Button
              variant="mark"
              size="sm"
              onClick={() => decide(item.id, 'reject')}
              loading={busy === item.id}
            >
              {t.admin.reject}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => decide(item.id, 'approve')}
              loading={busy === item.id}
            >
              {t.admin.approve}
            </Button>
          </SheetFooter>
        </Sheet>
      ))}
    </div>
  );
}
