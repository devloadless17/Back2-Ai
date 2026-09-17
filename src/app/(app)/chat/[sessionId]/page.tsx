import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ChatThread, type ChatMessageView } from '@/components/chat/chat-thread';
import { SubjectPicker } from '@/components/chat/subject-picker';
import { Alert } from '@/components/ui/feedback';
import { QuestionBody } from '@/components/ui/math';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { BackLink } from '@/components/ui/back-link';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { isAiConfigured, isEmbeddingConfigured } from '@/lib/env';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import { citedSources } from '@/lib/queries/cited-sources';
import { listSubjectsForStudent } from '@/lib/queries/taxonomy';

export const metadata: Metadata = { title: 'Ask a question' };

/**
 * One conversation.
 *
 * When the session is anchored to a question — the "Explain this" path from
 * practice — that question is pinned above the thread. The student asking
 * "why does step 3 work" should be able to see step 3 while they type.
 */
export default async function ChatSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const user = await requireUser();
  const { t } = await getTranslations();

  const session = await db.chatSession.findFirst({
    where: { id: sessionId, userId: user.id },
    select: {
      id: true,
      title: true,
      subjectId: true,
      subject: { select: { id: true, name: true } },
      uploadedImageUrl: true,
      question: {
        select: { id: true, contentText: true, contentLatex: true, chapter: { select: { name: true } } },
      },
      attempt: { select: { submittedAnswer: true, score: true, maxScore: true } },
      messages: {
        select: {
          id: true,
          role: true,
          content: true,
          groundingTier: true,
          citedSourceIds: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!session) notFound();

  const configured = isAiConfigured() && isEmbeddingConfigured();

  /*
   * Ask which subject only at the very start, and only when nothing else has
   * already answered it.
   *
   * A session anchored to a question came from a practice screen and its
   * subject is not in doubt. A session with messages in it has been running for
   * a while, and interrupting it with a question about scope would be asking
   * the student to re-decide something they are past. So the picker appears on
   * exactly one screen: a new, unanchored conversation before its first message
   * — which is the moment the student is deciding what to ask anyway.
   */
  const askForSubject =
    configured && session.messages.length === 0 && !session.question && !session.subjectId;

  const subjects = askForSubject
    ? await listSubjectsForStudent(user.trackId, user.preferredLanguage)
    : [];

  /*
   * Provenance for answers written before this page load.
   *
   * Evidence arrives on the `meta` event, which covers the answer being
   * streamed and nothing else — so reloading used to strip every earlier answer
   * of the thing that made it trustworthy. One lookup for the whole thread,
   * rather than one per message.
   */
  const stored = await citedSources(session.messages.flatMap((m) => m.citedSourceIds));

  const messages: ChatMessageView[] = session.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    tier: message.groundingTier,
    // A cited row that has since been re-ingested or deleted simply does not
    // come back; the answer shows fewer sources rather than a broken one.
    sources: message.citedSourceIds
      .map((id) => stored.get(id))
      .filter((s): s is NonNullable<typeof s> => s !== undefined),
  }));

  return (
    <>
      <BackLink href="/dashboard" label={t.nav.dashboard} />
      <PageHeader title={session.title ?? t.chat.title} description={t.chat.subtitle} />

      {!configured && (
        <Alert tone="warning" title={t.chat.aiNotConfigured} className="mb-5">
          {t.chat.aiNotConfiguredHint}
        </Alert>
      )}

      {askForSubject && (
        <div className="mb-5">
          <SubjectPicker
            sessionId={session.id}
            subjects={subjects}
            labels={{
              title: t.chat.subjectPickTitle,
              hint: t.chat.subjectPickHint,
              any: t.chat.subjectPickAny,
              anyHint: t.chat.subjectPickAnyHint,
              chapters: t.chat.subjectPickChapters,
              error: t.common.unknownError,
            }}
          />
        </div>
      )}

      {/* Which syllabus the answers are coming from, once it is settled. The
          student chose it several messages ago and the answers do not say. */}
      {session.subject && (
        <p className="mb-4 px-1 text-caption text-ink-faint">
          {format(t.chat.subjectScoped, { subject: session.subject.name })}
        </p>
      )}

      {session.question && (
        <Sheet className="mb-5">
          <SheetHeader
            title={t.practice.question}
            description={session.question.chapter?.name ?? undefined}
          />
          <SheetBody>
            <QuestionBody
              contentText={session.question.contentText}
              contentLatex={session.question.contentLatex}
            />
          </SheetBody>
        </Sheet>
      )}

      {/*
        Correction-key mode.

        The anchor stays on screen. It was a card at the top of the thread,
        which is the same as not being there once the conversation is six
        messages long — and this whole mode exists because the tutor says
        things like "your line 3", which is unreadable without line 3 present.

        So it sticks, collapsed to a chip by default. `<details>` rather than
        state: it survives without JavaScript, the summary is focusable and
        announced as a disclosure for free, and the open/closed choice persists
        while the student scrolls rather than resetting on every re-render.
      */}
      {session.attempt && (
        <details className="sticky top-0 z-20 mb-5 rounded-lg bg-paper-raised shadow-sheet" open>
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded-lg px-4 py-2.5 marker:hidden hover:bg-paper-sunken/60">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-caption font-semibold text-primary">
              {t.chat.anchoredAttempt}
            </span>
            {session.attempt.score !== null && session.attempt.maxScore !== null ? (
              <span className="numeric text-meta font-semibold text-ink">
                {Number(session.attempt.score)} / {Number(session.attempt.maxScore)}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-caption text-ink-muted">
              {t.chat.anchoredAttemptHint}
            </span>
          </summary>

          <div className="border-t border-rule px-4 py-3">
            <p className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-ink-faint">
              {t.practice.yourAnswer}
            </p>
            {session.attempt.submittedAnswer?.trim() ? (
              <pre className="scroll-x max-h-56 overflow-y-auto whitespace-pre-wrap font-mono text-meta leading-relaxed text-ink">
                {session.attempt.submittedAnswer}
              </pre>
            ) : (
              <p className="text-sm text-ink-muted">{t.examSim.notAnswered}</p>
            )}
          </div>
        </details>
      )}

      {session.uploadedImageUrl && (
        <Sheet className="mb-5">
          <SheetHeader title={t.upload.title} />
          <SheetBody>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/files/${session.uploadedImageUrl}`}
              alt={t.upload.extracted}
              className="max-h-80 w-auto rounded border border-rule"
            />
          </SheetBody>
        </Sheet>
      )}

      <ChatThread sessionId={session.id} initialMessages={messages} disabled={!configured} />
    </>
  );
}
