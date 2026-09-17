'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { FlagButton } from '@/components/practice/flag-button';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { Badge } from '@/components/ui/feedback';
import { Evidence, type EvidenceSource } from '@/components/chat/evidence';
import { GroundingState, TechnicalError, type RefusalKind } from '@/components/chat/grounding-state';
import { MathText } from '@/components/ui/math';
import { Sheet, SheetBody } from '@/components/ui/sheet';
import { IconCamera, IconClose, IconPaperclip } from '@/components/shell/icons';
import { cn } from '@/lib/cn';
import { ApiRequestError, sendForm } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';
import { format } from '@/lib/i18n/format';

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
  | 'conversational'
  | 'general_knowledge'
  | 'study_record';

export type ChatMessageView = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tier: GroundingTier | null;
  /*
   * `EvidenceSource` rather than a local shape. What the student is shown about
   * provenance is decided in one component, and a second definition here would
   * be free to drift from it — which is how a UI ends up claiming "official"
   * about a row that never said so.
   */
  sources: EvidenceSource[];
  /** Which refusal, when this message is one. Absent on every other message. */
  refusal?: RefusalKind;
};

type StreamEvent =
  | {
      type: 'meta';
      tier: GroundingTier;
      sources: EvidenceSource[];
      topSimilarity: number | null;
      refusal?: RefusalKind;
    }
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: string; verified: boolean }
  | { type: 'retracted'; messageId: string; reason: string }
  | { type: 'error'; message: string };

/**
 * What to tell a student whose photo did not go through.
 *
 * One message for every failure was worse than useless: an iPhone shooting HEIC
 * is refused for its type, and "try a sharper one" sends the student back to
 * retake a photo that will be refused again for exactly the same reason. The
 * status code already knows which of these it is.
 */
function uploadError(err: unknown, t: ReturnType<typeof useI18n>['t']): string {
  if (!(err instanceof ApiRequestError)) return t.common.unknownError;
  if (err.status === 402) return t.upload.budgetExhausted;
  if (err.status === 415) return t.upload.wrongType;
  // A document with no text layer is a scan, and "try a sharper photo" is
  // useless advice to someone who uploaded a PDF. Its own message.
  if (err.status === 422 && err.code === 'DOCUMENT_HAS_NO_TEXT') return t.upload.noTextInDocument;
  if (err.status === 413) return t.upload.tooBig;
  if (err.status === 503) return t.upload.serviceDown;
  return t.upload.failed;
}

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
  /*
   * The question that failed, kept so it can be sent again.
   *
   * Without it a retry button is a lie — the text was cleared from the composer
   * the moment it was sent, so "try again" would have had nothing to try.
   */
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);

  /*
   * Where a student goes to name a subject, offered when a refusal says nothing
   * in their material matched. This conversation is the page they are on, so it
   * is a reload of it — the picker appears when a session has no subject.
   */
  const subjectHref = `/chat/${sessionId}`;

  // Photo attachment state.
  const fileRef = useRef<HTMLInputElement>(null);
  /*
   * A SECOND input, for documents, rather than widening the first.
   *
   * The photo input carries `capture="environment"`, which is what makes an
   * iPhone transcode HEIC to JPEG as the picture is taken — see the note on it
   * below, it was a real bug. That same attribute makes the picker open the
   * CAMERA, so a student could never reach the file on their phone through it.
   * Two inputs keep both behaviours instead of trading one for the other.
   */
  const docRef = useRef<HTMLInputElement>(null);
  const [attachedName, setAttachedName] = useState<string | null>(null);
  /** True when the file was too long for the box and was stored as a reference. */
  const [storedWhole, setStoredWhole] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string | null>(null);
  const [illegible, setIllegible] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  /*
   * FOLLOW THE ANSWER ONLY IF THE STUDENT IS STILL AT THE BOTTOM.
   *
   * This fired on every `messages` change, which during streaming is every
   * token. A student who scrolled up to reread the question — or to check an
   * equation three paragraphs back — was dragged to the bottom several times a
   * second and could not read anything. On a phone, where the answer is many
   * screens long and the thumb is already on the glass, it made a long answer
   * unusable.
   *
   * So: near the bottom, follow. Anywhere else, hold position and offer a way
   * back. The threshold is generous because "at the bottom" should include
   * somebody a line or two above it, not only an exact match.
   */
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    function onScroll() {
      const gap =
        document.documentElement.scrollHeight -
        window.scrollY -
        window.innerHeight;
      setFollowing(gap < 120);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!following) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, following]);

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
  async function attach(file: File, kind: 'photo' | 'document' = 'photo') {
    setError(null);
    setAttaching(true);
    setAttachedName(kind === 'document' ? file.name : null);
    /*
     * Only a photograph gets an object-URL preview. A PDF or a Word file has
     * nothing to show, and an <img> pointed at one renders a broken-image icon,
     * which reads as "your upload failed" at the exact moment it succeeded.
     */
    setPreview(kind === 'photo' ? URL.createObjectURL(file) : null);

    const form = new FormData();
    form.append('file', file);
    form.append('sessionId', sessionId);

    try {
      const response = await sendForm<{
        extractedText: string;
        hasIllegibleRegions: boolean;
        previewOnly?: boolean;
      }>('/api/upload', form);
      setTranscription(response.extractedText);
      setIllegible(response.hasIllegibleRegions);
      /*
       * A long document is stored whole and searched; only an opening goes in
       * the box. Saying so matters — a student looking at the first paragraph
       * of their ten-page handout would otherwise assume that is all the tutor
       * received, and retype the rest.
       */
      setStoredWhole(response.previewOnly === true);
    } catch (err) {
      // Say which thing went wrong. "Try a sharper one" cannot help a file
        // refused for its type or its size, and it sends the student round a
        // loop with no exit.
        setError(uploadError(err, t));
      clearAttachment();
    } finally {
      setAttaching(false);
    }
  }

  /*
   * Send the last question again after a technical failure.
   *
   * Only offered for a TECHNICAL error — a refusal is not something retrying
   * fixes, and a retry button under one would suggest the tutor could be talked
   * round. Drops the failed pair first so the thread does not accumulate a
   * half-written answer per attempt.
   */
  async function retry() {
    const question = lastQuestion;
    if (!question || streaming) return;
    setMessages((current) => current.filter((m) => !m.id.startsWith('pending')));
    setError(null);
    await ask(question);
  }

  function clearAttachment() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setAttachedName(null);
    setStoredWhole(false);
    setTranscription(null);
    setIllegible(false);
    // Both, and by value rather than by ref identity: leaving the old filename
    // in an input means re-choosing the same file fires no change event, so a
    // student who retries after an error appears to click a dead button.
    if (fileRef.current) fileRef.current.value = '';
    if (docRef.current) docRef.current.value = '';
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const typed = input.trim();
    // A photo on its own is a question: "explain this". Requiring words as well
    // would make the attachment useless on its own.
    /*
     * Trimmed to what the server accepts, rather than sent and rejected.
     *
     * `chat/messages` caps content at 4,000 characters and answers anything
     * longer with a 422 the student cannot act on — which is exactly what
     * happened the day documents became attachable. The upload route no longer
     * hands back more than that, and this is the second line of the same
     * defence: a long preview plus a long typed question can still cross it.
     */
    const question = [transcription?.trim(), typed]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 4000);
    if (!question || streaming || disabled) return;

    setInput('');
    clearAttachment();
    await ask(question);
  }

  /*
   * One question, start to finish.
   *
   * Split out of `send` so `retry` can reuse it. `send` owns the composer —
   * reading the box, folding in a transcription, clearing both — and this owns
   * the request. A retry has no composer state to read; it has a question it
   * was already given.
   */
  async function ask(question: string) {
    setError(null);
    setLastQuestion(question);
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
            /*
             * MERGED, NOT REPLACED. The refusal path emits a second `meta` once
             * it knows which refusal it is, and that one carries no sources — a
             * replace would wipe provenance the first event had already
             * delivered. `??` rather than `||` so an empty array from the
             * second event does not overwrite a populated one.
             */
            return {
              ...message,
              tier: event.tier,
              sources: event.sources.length > 0 ? event.sources : message.sources,
              refusal: event.refusal ?? message.refusal,
            };
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
              // Its own refusal kind: an answer was written and then withdrawn,
              // which is neither "show me the passage" nor "off your programme".
              refusal: 'retracted' as const,
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
                <p className="whitespace-pre-wrap text-body leading-relaxed text-ink">
                  {message.content}
                </p>
              </div>
            </div>
          ) : message.refusal && message.content ? (
            /*
             * A refusal is not an answer with no sources; it is a different
             * kind of response, and rendering it in the answer shell put it
             * under a rose badge meaning "lost marks" with an empty evidence
             * slot beneath. Its own component, its own recovery.
             */
            <GroundingState
              key={message.id}
              kind={message.refusal}
              text={message.content}
              subjectHref={subjectHref}
            />
          ) : (
            <Sheet key={message.id} className="animate-fade-up">
              {/*
                The tier badge alone. The source list used to sit here, joined
                with middots and truncated by CSS — three labels reduced to
                "Fonctions logarithmes — past ques…", which told a student
                nothing and cost the width of the header to say it. Provenance
                is now attached UNDER the answer, where it belongs: evidence
                follows a claim, it does not precede it.
              */}
              <div className="flex items-center gap-3 border-b border-rule px-5 py-2">
                <GroundingLabel tier={message.tier} />
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
                  /*
                   * WHAT IT IS READING, WHILE IT READS IT.
                   *
                   * Retrieval finishes before generation starts, so the sources
                   * arrive on the `meta` event — ahead of the first token. The
                   * header has always shown them; the body said "Thinking…",
                   * which is what every chat box on the internet says and tells
                   * a student nothing.
                   *
                   * Naming the chapter turns the wait into evidence that the
                   * answer is coming from their own syllabus, at the one moment
                   * they have nothing else to look at. It also lets them catch a
                   * wrong subject before reading a paragraph of it.
                   *
                   * Falls back to "Thinking…" before `meta` lands, which is the
                   * honest thing to say while retrieval is still running.
                   */
                  <p className="text-sm text-ink-faint">
                    {message.sources.length > 0
                      ? format(t.chat.readingFrom, {
                          count: message.sources.length,
                          source: message.sources[0]!.label,
                        })
                      : t.chat.thinking}
                  </p>
                )}

                {/*
                  EVIDENCE FOLLOWS THE CLAIM.
                  
                  Rendered inside the body rather than in a footer of its own, so
                  it sits against the text it supports and shares its measure.
                  Only once there is text: during streaming the sources are
                  already known, but an evidence block above a half-written
                  answer is a citation for something nobody has read yet.
                */}
                {message.content && message.sources.length > 0 && (
                  <Evidence sources={message.sources} />
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

      {/*
        Offered only while an answer is still arriving and the student has moved
        away from it. Not a permanent control: a button that is always there is
        chrome, and one that appears when it is useful is an answer to a
        question the student just asked by scrolling.
      */}
      {streaming && !following && (
        <button
          type="button"
          onClick={() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}
          className="sticky bottom-24 z-10 mx-auto flex h-9 items-center gap-1.5 rounded-full border border-rule bg-paper-raised px-4 text-caption font-medium text-ink shadow-sm lg:bottom-20"
        >
          {t.chat.jumpToLatest}
          <span aria-hidden>↓</span>
        </button>
      )}

      {/*
        A TECHNICAL FAILURE, never a refusal. `GroundingState` above handles the
        case where Nour declined; this is the case where something broke, and
        the two must not look alike — a student who reads an outage as caution
        will wait instead of retrying.
      */}
      {error && <TechnicalError message={error} onRetry={retry ?? undefined} />}

      <form onSubmit={send} className="sticky bottom-4 space-y-2">
        <Sheet>
          <SheetBody className="space-y-2 p-3">
            {preview || attachedName ? (
              <div className="flex gap-3 rounded-lg bg-paper-sunken/60 p-2.5">
                {/*
                  A photo shows itself. A document cannot, so it shows its name
                  in the same slot — the student needs to see WHICH file the
                  tutor is about to read, and a blank square would say nothing.
                */}
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- object URL, never optimised
                  <img
                    src={preview}
                    alt=""
                    className="h-20 w-20 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-md bg-paper px-1 text-center">
                    <IconPaperclip width={18} height={18} />
                    <span className="line-clamp-2 break-all text-caption text-ink-faint">
                      {attachedName}
                    </span>
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-caption font-semibold uppercase tracking-wide text-ink-faint">
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
                      className="text-meta"
                    />
                  ) : null}

                  {illegible ? (
                    <p className="text-caption text-partial">{t.upload.illegible}</p>
                  ) : null}

                  {/*
                    Only an opening is in the box; the whole file is stored and
                    searchable. Without this line a student sees one paragraph
                    of a ten-page handout and reasonably concludes the rest was
                    lost.
                  */}
                  {storedWhole ? (
                    <p className="text-caption text-ink-faint">{t.upload.storedWhole}</p>
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
                /*
                 * The formats the server actually takes, not image/*.
                 *
                 * An iPhone photographs in HEIC. With image/* the picker hands that
                 * straight over, the server refuses it as an unsupported type, and the
                 * student is told to try a sharper photo — which can never work, so
                 * they retake it and fail again. Naming the formats makes iOS
                 * transcode to JPEG as the picture is chosen, which is the whole fix.
                 */
                accept="image/png,image/jpeg,image/webp"
                capture="environment"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void attach(file);
                }}
              />
              <input
                ref={docRef}
                type="file"
                /*
                 * No `capture` here, deliberately — that attribute opens the
                 * camera and would put a document picker out of reach. The
                 * types are named rather than left open so the picker greys out
                 * what the server would refuse, instead of letting a student
                 * choose a .doc or a .pages and learn it was wrong afterwards.
                 */
                accept={
                  'application/pdf,text/plain,' +
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
                  'image/png,image/jpeg,image/webp'
                }
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void attach(file, 'document');
                }}
              />

              <div className="flex items-center gap-1">
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
                  type="button"
                  size="sm"
                  variant="quiet"
                  disabled={disabled || streaming || attaching}
                  onClick={() => docRef.current?.click()}
                >
                  <IconPaperclip width={16} height={16} />
                  <span className="ms-1.5">{t.upload.attachFile}</span>
                </Button>
              </div>

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

  if (!tier) return <span className="text-caption text-ink-faint">{t.chat.thinking}</span>;

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
    /*
     * Shares the refusal's tone on purpose.
     *
     * The tones here rank provenance, and this answer has none — it is closer to
     * a refusal than to a citation, whatever its length. Giving it its own
     * friendlier colour would let a student learn to read "has a badge" as "is
     * safe to quote", which is the exact distinction the badge exists to draw.
     *
     * The badge is the redundant channel, not the primary one: the answer body
     * already opens with the notice, so nothing is lost to a colour-vision
     * difference or to a student who never looks up here.
     */
    general_knowledge: { tone: 'mark', label: t.chat.groundingGeneralKnowledge },
    /*
     * The one non-curriculum lane that earns a confident tone. These facts
     * are not recalled or retrieved — they are the rows the rest of the app
     * is rendering from on the same page load.
     */
    study_record: { tone: 'partial', label: t.chat.groundingStudyRecord },
  };

  const { tone, label } = config[tier];

  return (
    <Badge tone={tone} className={cn('shrink-0')}>
      {label}
    </Badge>
  );
}
