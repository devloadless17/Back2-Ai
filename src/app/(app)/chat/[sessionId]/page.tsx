import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ChatThread, type ChatMessageView } from '@/components/chat/chat-thread';
import { Alert, Badge } from '@/components/ui/feedback';
import { QuestionBody } from '@/components/ui/math';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { isAiConfigured, isEmbeddingConfigured } from '@/lib/env';
import { getTranslations } from '@/lib/i18n';

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

  const messages: ChatMessageView[] = session.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    tier: message.groundingTier,
    sources: [],
  }));

  return (
    <>
      <PageHeader title={session.title ?? t.chat.title} description={t.chat.subtitle} />

      {!configured && (
        <Alert tone="warning" title={t.chat.aiNotConfigured} className="mb-5">
          {t.chat.aiNotConfiguredHint}
        </Alert>
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

      {/* Correction-key mode. The student's own answer is pinned next to the
          question, because the conversation is about the gap between them and
          reading the tutor's references to "your line 3" is impossible without
          line 3 on screen. */}
      {session.attempt && (
        <Sheet className="mb-5">
          <SheetHeader
            title={t.chat.anchoredAttempt}
            description={t.chat.anchoredAttemptHint}
            actions={
              session.attempt.score !== null && session.attempt.maxScore !== null ? (
                <Badge tone="partial">
                  {Number(session.attempt.score)} / {Number(session.attempt.maxScore)}
                </Badge>
              ) : null
            }
          />
          <SheetBody className="bg-paper-sunken/40">
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
              {t.practice.yourAnswer}
            </p>
            {session.attempt.submittedAnswer?.trim() ? (
              <pre className="scroll-x whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-ink">
                {session.attempt.submittedAnswer}
              </pre>
            ) : (
              <p className="text-sm text-ink-muted">{t.examSim.notAnswered}</p>
            )}
          </SheetBody>
        </Sheet>
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
