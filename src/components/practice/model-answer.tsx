'use client';

import { useState } from 'react';

import { MathText } from '@/components/ui/math';
import { SheetBody } from '@/components/ui/sheet';
import { ApiRequestError, sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

type Response =
  | { status: 'ok'; solution: string; official: boolean; cached: boolean }
  | { status: 'declined' | 'not_configured' };

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; solution: string; official: boolean }
  | { kind: 'message'; text: string; retry: boolean };

/**
 * A model answer for a question that has no official one, written on request.
 *
 * Nothing is fetched until the student opens it: the first student to ask pays
 * for the answer once, the question keeps it, and everyone after reads the
 * stored copy. The note under the heading stays — a student must be able to
 * tell this apart from the ministry's answer key.
 */
export function ModelAnswer({ questionId, dir }: { questionId: string; dir?: 'rtl' | 'ltr' }) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function load() {
    if (state.kind === 'loading' || state.kind === 'ready') return;
    if (state.kind === 'message' && !state.retry) return;
    setState({ kind: 'loading' });
    try {
      const response = await sendJson<Response>('/api/questions/model-solution', 'POST', { questionId });
      if (response.status === 'ok') {
        setState({ kind: 'ready', solution: response.solution, official: response.official });
      } else {
        setState({ kind: 'message', text: t.practice.modelAnswerDeclined, retry: false });
      }
    } catch (error) {
      const budget = error instanceof ApiRequestError && error.code === 'AI_BUDGET_EXHAUSTED';
      setState({
        kind: 'message',
        text: budget ? t.practice.modelAnswerBudget : t.practice.modelAnswerFailed,
        retry: !budget,
      });
    }
  }

  return (
    <details
      className="border-t border-rule"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) void load();
      }}
    >
      <summary className="cursor-pointer list-none px-5 py-3 text-meta font-medium text-ink transition-colors hover:bg-paper-sunken">
        {state.kind === 'ready' && state.official ? t.practice.officialSolution : t.practice.showModelAnswer}
      </summary>
      <SheetBody className="space-y-3 pt-0">
        {state.kind === 'loading' && <p className="text-meta text-ink-muted">{t.practice.modelAnswerWriting}</p>}
        {state.kind === 'message' && <p className="text-meta text-ink-muted">{state.text}</p>}
        {state.kind === 'ready' && (
          <>
            {!state.official && <p className="text-meta text-ink-muted">{t.practice.modelAnswerNote}</p>}
            <MathText dir={dir}>{state.solution}</MathText>
          </>
        )}
      </SheetBody>
    </details>
  );
}
