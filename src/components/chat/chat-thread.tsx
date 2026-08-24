'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { FlagButton } from '@/components/practice/flag-button';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { Alert, Badge } from '@/components/ui/feedback';
import { MathText } from '@/components/ui/math';
import { Sheet, SheetBody } from '@/components/ui/sheet';
import { IconCamera, IconClose } from '@/components/shell/icons';
import { cn } from '@/lib/cn';
import { ApiRequestError, sendForm } from '@/lib/client/request';
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

type GroundingTier =
  | 'exact_match'
  | 'concept_level'
  | 'personal_reference'
  | 'ungrounded_refused'
  | 'conversational';

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

  // Photo attachment state.
  const fileRef = useRef<HTMLInputElement>(null);
  const [attaching, setAttaching] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string | null>(null);
  const [illegible, setIllegible] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  /*
   * A photo clipped to the conversation.
   *
   * The transcription stays editable before anything is asked, which is the one
   * part of the old upload page worth carrying over intact: handwritten
   * mathematics does not survive OCR reliably, and a misread exponent produces a
   * confident, fluent answer to a question the student never asked — with no
   * way for them to tell that is what happened. Letting them fix it costs a
   * couple of lines on screen and removes the failure mode entirely.
   */
  async function attach(file: File) {
    setError(null);
    setAttaching(true);
    setPreview(URL.createObjectURL(file));

    const form = new FormData();
    form.append('file', file);
    form.append('sessionId', sessionId);

    try {
      const response = await sendForm<{ extractedText: string; hasIllegibleRegions: boolean }>(
        '/api/upload',
        form,
      );
      setTranscription(response.extractedText);
      setIllegible(response.hasIllegibleRegions);
    } catch (err) {
      setError(err instanceof ApiRequestError ? t.upload.failed : t.common.unknownError);
      clearAttachment();
    } finally {
      setAttaching(false);
    }
  }

  function clearAttachment() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setTranscription(null);
    setIllegible(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const typed = input.trim();
    // A photo on its own is a question: "explain this". Requiring words as well
    // would make the attachment useless on its own.
    const question = [transcription?.trim(), typed].filter(Boolean).join('\n\n');
    if (!question || streaming || disabled) return;

    setInput('');
    clearAttachment();
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
                  <p className=" text-sm text-ink-faint">{t.chat.thinking}</p>
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
            {preview ? (
              <div className="flex gap-3 rounded-lg bg-paper-sunken/60 p-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element -- object URL, never optimised */}
                <img
                  src={preview}
                  alt=""
                  className="h-20 w-20 shrink-0 rounded-md object-cover"
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">
                      {attaching ? t.upload.reading : t.upload.checkTranscription}
                    </p>
                    <button
                      type="button"
                      onClick={clearAttachment}
                      aria-label={t.common.close}
                      className="rounded p-1 text-ink-muted hover:bg-paper-sunken"
                    >
                      <IconClose width={14} height={14} />
                    </button>
                  </div>

                  {transcription !== null ? (
                    <Textarea
                      value={transcription}
                      onChange={(event) => setTranscription(event.target.value)}
                      rows={3}
                      className="text-[13px]"
                    />
                  ) : null}

                  {illegible ? (
                    <p className="text-[11.5px] text-partial">{t.upload.illegible}</p>
                  ) : null}
                </div>
              </div>
            ) : null}

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
            <div className="flex items-center justify-between gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void attach(file);
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="quiet"
                disabled={disabled || streaming || attaching}
                onClick={() => fileRef.current?.click()}
              >
                <IconCamera width={16} height={16} />
                <span className="ms-1.5">{t.upload.attach}</span>
              </Button>

              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={streaming}
                disabled={disabled || (input.trim().length === 0 && !transcription)}
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

  /*
   * A greeting gets no badge at all.
   *
   * Every other tier is a claim about where an answer came from, and a greeting
   * has no provenance to report. Showing one here is what produced the original
   * bug in a different form: "Not covered by the curriculum" over "hello" was a
   * grounding claim on a message that asked for none, and a reassuring green
   * badge would be the same mistake pointing the other way.
   */
  if (tier === 'conversational') return null;

  const config: Record<Exclude<GroundingTier, 'conversational'>, {
    tone: 'correct' | 'primary' | 'partial' | 'mark';
    label: string;
  }> = {
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
