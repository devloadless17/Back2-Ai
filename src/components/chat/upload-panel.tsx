'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { ApiRequestError, sendForm } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

/**
 * Photo → transcription → grounded question.
 *
 * The transcription is shown back and is editable before anything is asked.
 * Handwritten mathematics does not survive OCR intact often enough to skip this
 * step: a misread exponent turns into a confident, fluent answer to a question
 * the student never asked, and they have no way to tell that is what happened.
 * Letting them fix it costs one screen and removes the entire failure mode.
 */

type UploadResponse = {
  sessionId: string;
  imageKey: string;
  extractedText: string;
  hasIllegibleRegions: boolean;
};

export function UploadPanel() {
  const { t } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<'idle' | 'uploading' | 'review' | 'sending'>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [text, setText] = useState('');
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    setError(null);
    setPhase('uploading');
    setPreview(URL.createObjectURL(file));

    const form = new FormData();
    form.append('file', file);

    try {
      const response = await sendForm<UploadResponse>('/api/upload', form);
      setResult(response);
      setText(response.extractedText);
      setPhase('review');
    } catch (err) {
      setError(messageFor(err));
      setPhase('idle');
    }
  }

  /** Sends the (possibly corrected) transcription as the first turn. */
  async function ask() {
    if (!result || phase === 'sending') return;
    setPhase('sending');
    setError(null);

    const content = [text.trim(), question.trim()].filter(Boolean).join('\n\n');

    try {
      // Fire the turn and let the thread render it; the answer streams into the
      // conversation the student is about to land on.
      const response = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: result.sessionId, content }),
      });

      // Drain the stream so the turn completes and is persisted before we
      // navigate — otherwise the thread loads mid-generation and shows nothing.
      if (response.body) {
        const reader = response.body.getReader();
        for (;;) {
          const { done } = await reader.read();
          if (done) break;
        }
      }

      router.push(`/chat/${result.sessionId}`);
    } catch {
      setError(t.common.unknownError);
      setPhase('review');
    }
  }

  function messageFor(err: unknown): string {
    if (err instanceof ApiRequestError) {
      switch (err.code) {
        case 'OCR_EMPTY':
        case 'OCR_FAILED':
          return `${t.upload.readFailed} ${t.upload.readFailedHint}`;
        case 'FILE_TOO_LARGE':
        case 'UNSUPPORTED_FILE_TYPE':
          return t.upload.readFailedHint;
        default:
          return t.common.unknownError;
      }
    }
    return t.common.unknownError;
  }

  // --- Review the transcription ------------------------------------------
  if (phase === 'review' || phase === 'sending') {
    return (
      <div className="grid gap-5 lg:grid-cols-2">
        {preview && (
          <Sheet>
            <SheetHeader title={t.upload.title} />
            <SheetBody>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="" className="max-h-[28rem] w-auto rounded border border-rule" />
            </SheetBody>
          </Sheet>
        )}

        <Sheet>
          <SheetHeader title={t.upload.extracted} description={t.upload.looksWrong} />
          <SheetBody className="space-y-3">
            {result?.hasIllegibleRegions && <Alert tone="warning">{t.upload.readFailedHint}</Alert>}

            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={10}
              className="min-h-[14rem] font-mono text-[13px] leading-relaxed"
            />

            <Textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={t.chat.placeholder}
              rows={2}
              className="min-h-[4.5rem]"
            />

            {error && <Alert tone="error">{error}</Alert>}
          </SheetBody>

          <SheetFooter className="justify-between">
            <Button
              variant="quiet"
              onClick={() => {
                setPhase('idle');
                setResult(null);
                setPreview(null);
              }}
            >
              {t.common.cancel}
            </Button>
            <Button variant="primary" onClick={ask} loading={phase === 'sending'}>
              {t.upload.continue}
            </Button>
          </SheetFooter>
        </Sheet>
      </div>
    );
  }

  // --- Choose a file ------------------------------------------------------
  return (
    <div className="space-y-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void upload(file);
        }}
        className={cn(
          'flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center',
          'transition-colors duration-150',
          dragging ? 'border-primary bg-primary-soft' : 'border-rule-strong bg-paper-sunken',
        )}
      >
        <p className="text-lg font-extrabold tracking-tight text-ink">{t.upload.dropzone}</p>
        <p className="max-w-sm text-sm text-ink-muted">{t.upload.subtitle}</p>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />

        <Button
          variant="primary"
          onClick={() => inputRef.current?.click()}
          loading={phase === 'uploading'}
        >
          {phase === 'uploading' ? t.upload.reading : t.upload.choose}
        </Button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
