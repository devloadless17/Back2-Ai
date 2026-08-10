'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { FlagButton } from '@/components/practice/flag-button';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { Alert, Badge } from '@/components/ui/feedback';
import { MathText } from '@/components/ui/math';
import { Sheet, SheetBody } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';

/**
 * The conversation.
 *
 * Answers stream token by token. The grounding label arrives *before* the first
 * token — it comes from retrieval, which has already finished by the time
 * generation starts — so the student can see what the answer is based on while
 * it is still being written, rather than being told afterwards.
 *
 * A retraction is handled visibly: if the verification pass rejects an answer
 * that has already been streamed, the text is replaced and labelled. Silently
 * leaving an unverifiable derivation on screen because it had already been sent
 * would be the easy option and the wrong one.
 */

type GroundingTier = 'exact_match' | 'concept_level' | 'personal_reference' | 'ungrounded_refused';

export type ChatMessageView = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tier: GroundingTier | null;
  sources: { id: string; label: string; similarity: number }[];
};

type StreamEvent =
  | { type: 'meta'; tier: GroundingTier; sources: { id: string; label: string; similarity: number }[]; topSimilarity: number | null }
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: string; verified: boolean }
  | { type: 'retracted'; messageId: string; reason: string }
  | { type: 'error'; message: string };

export function ChatThread({
  sessionId,
  initialMessages,
  disabled,
}: {
  sessionId: string;
  initialMessages: ChatMessageView[];
  disabled: boolean;
}) {
  const { t } = useI18n();

  const [messages, setMessages] = useState<ChatMessageView[]>(initialMessages);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const question = input.trim();
    if (!question || streaming || disabled) return;

    setInput('');
    setError(null);
    setStreaming(true);

    const pendingId = `pending-${Date.now()}`;

    setMessages((current) => [
      ...current,
      { id: `${pendingId}-user`, role: 'user', content: question, tier: null, sources: [] },
      { id: pendingId, role: 'assistant', content: '', tier: null, sources: [] },
    ]);

    try {
      const response = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, content: question }),
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? 'STREAM_FAILED');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // NDJSON: everything up to the last newline is complete events.
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;

          let event: StreamEvent;
          try {
            event = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }

          applyEvent(event, pendingId);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'AI_NOT_CONFIGURED'
          ? t.chat.aiNotConfigured
          : t.common.unknownError,
      );
      setMessages((current) => current.filter((m) => m.id !== pendingId));
    } finally {
      setStreaming(false);
    }
  }

  function applyEvent(event: StreamEvent, pendingId: string) {
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== pendingId) return message;

        switch (event.type) {
          case 'meta':
            return { ...message, tier: event.tier, sources: event.sources };
          case 'delta':
            return { ...message, content: message.content + event.text };
          case 'done':
            return { ...message, id: event.messageId };
          case 'retracted':
            return {
              ...message,
              id: event.messageId,
              content: event.reason,
              tier: 'ungrounded_refused',
              sources: [],
            };
          default:
            return message;
        }
      }),
    );

    if (event.type === 'error') setError(t.common.unknownError);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        {messages.length === 0 && (
          <Sheet>
            <SheetBody>
              <p className="text-sm text-ink-muted">{t.chat.noSessionsHint}</p>
            </SheetBody>
          </Sheet>
        )}

        {messages.map((message) =>
          message.role === 'user' ? (
            <div key={message.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-lg rounded-ee-sm bg-primary-soft px-4 py-2.5">
                <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-ink">
                  {message.content}
                </p>
              </div>
            </div>
          ) : (
            <Sheet key={message.id} className="animate-fade-up">
              <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-2">
                <GroundingLabel tier={message.tier} />
                {message.sources.length > 0 && (
                  <span className="truncate text-[11.5px] text-ink-faint">
                    {t.chat.sources}: {message.sources.map((s) => s.label).join(' · ')}
                  </span>
                )}
              </div>

              {/*
                A streamed answer appears token by token, which a screen reader
                would otherwise never announce — the DOM changes but nothing
                tells assistive tech to read it. `polite` waits for a pause
                rather than interrupting on every token.
              */}
              <SheetBody aria-live="polite" aria-busy={message.id.startsWith('pending')}>
                {message.content ? (
                  <MathText>{message.content}</MathText>
                ) : (
                  <p className="animate-pulse-slow text-sm text-ink-faint">{t.chat.thinking}</p>
                )}
              </SheetBody>

              {message.content && !message.id.startsWith('pending') && (
                <div className="border-t border-rule px-5 py-2">
                  <FlagButton itemType="flagged_content" itemId={message.id} />
                </div>
              )}
            </Sheet>
          ),
        )}

        <div ref={endRef} />
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <form onSubmit={send} className="sticky bottom-4 space-y-2">
        <Sheet>
          <SheetBody className="space-y-2 p-3">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends; Shift+Enter is a newline. Students paste
                // multi-line working in here.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(event as unknown as FormEvent);
                }
              }}
              placeholder={t.chat.placeholder}
              disabled={disabled || streaming}
              rows={2}
              className="min-h-[3.5rem] border-0 bg-transparent focus-visible:ring-0"
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={streaming}
                disabled={disabled || input.trim().length === 0}
              >
                {t.chat.send}
              </Button>
            </div>
          </SheetBody>
        </Sheet>
      </form>
    </div>
  );
}

function GroundingLabel({ tier }: { tier: GroundingTier | null }) {
  const { t } = useI18n();

  if (!tier) return <span className="text-[11.5px] text-ink-faint">{t.chat.thinking}</span>;

  const config: Record<GroundingTier, { tone: 'correct' | 'primary' | 'partial' | 'mark'; label: string }> = {
    exact_match: { tone: 'correct', label: t.chat.groundingExactMatch },
    concept_level: { tone: 'primary', label: t.chat.groundingConceptLevel },
    personal_reference: { tone: 'partial', label: t.chat.groundingPersonalReference },
    ungrounded_refused: { tone: 'mark', label: t.chat.groundingRefused },
  };

  const { tone, label } = config[tier];

  return (
    <Badge tone={tone} className={cn('shrink-0')}>
      {label}
    </Badge>
  );
}
