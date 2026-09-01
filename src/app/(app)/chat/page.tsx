import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Alert, EmptyState } from '@/components/ui/feedback';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { NewConversationButton } from '@/components/chat/new-conversation-button';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { isAiConfigured, isEmbeddingConfigured } from '@/lib/env';
import { getTranslations } from '@/lib/i18n';
import { formatDate } from '@/lib/i18n/format';

export const metadata: Metadata = { title: 'Ask a question' };

/**
 * Conversation list.
 *
 * The configuration notice is shown rather than hidden: an unkeyed deployment
 * should be honest about which features are inert, not present a chat box that
 * fails on submit.
 */
export default async function ChatIndexPage() {
  const user = await requireUser();
  const { locale, t } = await getTranslations();

  const sessions = await db.chatSession.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      questionId: true,
      _count: { select: { messages: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  // Nothing to list and everything working: skip the empty index entirely and
  // put the student in front of a text box.
  if (sessions.length === 0 && isAiConfigured() && isEmbeddingConfigured()) {
    const session = await db.chatSession.create({ data: { userId: user.id }, select: { id: true } });
    redirect(`/chat/${session.id}`);
  }

  const configured = isAiConfigured() && isEmbeddingConfigured();

  return (
    <>
      <PageHeader
        title={t.chat.title}
        description={t.chat.subtitle}
        actions={configured ? <NewConversationButton /> : null}
      />

      {!configured && (
        <Alert tone="warning" title={t.chat.aiNotConfigured} className="mb-5">
          {t.chat.aiNotConfiguredHint}
        </Alert>
      )}

      {sessions.length === 0 ? (
        <EmptyState tone="neutral" title={t.chat.noSessions} body={t.chat.noSessionsHint} />
      ) : (
        <Sheet>
          <SheetHeader title={t.chat.title} />
          <SheetBody className="p-0">
            <ul className="ruled">
              {sessions.map((session) => (
                <li key={session.id}>
                  <Link
                    href={`/chat/${session.id}`}
                    className="flex items-baseline justify-between gap-4 px-5 py-3.5 transition-colors duration-150 hover:bg-paper-sunken"
                  >
                    <span className="min-w-0 truncate text-sm text-ink">
                      {session.title ?? t.chat.newSession}
                    </span>
                    <span className="shrink-0 text-caption text-ink-faint">
                      {formatDate(locale, session.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </SheetBody>
        </Sheet>
      )}
    </>
  );
}
