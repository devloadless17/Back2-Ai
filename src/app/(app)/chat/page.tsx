import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SessionList, type ChatSessionRow } from '@/components/chat/session-list';
import { NewConversationButton } from '@/components/chat/new-conversation-button';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { isAiConfigured, isEmbeddingConfigured } from '@/lib/env';
import { getTranslations } from '@/lib/i18n';
import { formatDate } from '@/lib/i18n/format';

export const metadata: Metadata = { title: 'Ask a question' };

const PAGE_SIZE = 50;

/**
 * Conversation list, searchable.
 *
 * SEARCH READS THE MESSAGES, not only the title. A title is generated from the
 * first question and is null until one exists, so a student looking for "that
 * conversation about the naval blockade" is looking for something they typed,
 * not something we named. Matching titles alone would miss every conversation
 * they had not yet named — which is most of them.
 *
 * `fold_arabic` on both sides, the same function the lexical index uses. Arabic
 * spells one word several ways — تَعْريف and تعريف — and a LIKE over the display
 * form matches none of them, which would make the feature look broken to
 * exactly the students who need it most.
 *
 * A plain GET form, so the search is the URL: it survives a refresh, the back
 * button and being sent to somebody. No client JavaScript is involved in
 * finding a conversation.
 *
 * The configuration notice is shown rather than hidden: an unkeyed deployment
 * should be honest about which features are inert, not present a chat box that
 * fails on submit.
 */
export default async function ChatIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { locale, t } = await getTranslations();

  const params = await searchParams;
  const raw = params.q;
  const query = ((Array.isArray(raw) ? raw[0] : raw) ?? '').trim().slice(0, 120);

  /*
   * "Ask a question" opens a conversation, not a list of them: the greeting
   * and the box, with the recent ones down the side. The full list — with its
   * search — is still here, behind `?all=1`, which the side column links to.
   *
   * An empty conversation already waiting is reused rather than another made,
   * so opening this page ten times does not leave ten blank drafts behind.
   */
  if (!query && !params.all && isAiConfigured() && isEmbeddingConfigured()) {
    const draft = await db.chatSession.findFirst({
      where: { userId: user.id, messages: { none: {} }, questionId: null, attemptId: null, uploadedImageUrl: null },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    const session =
      draft ?? (await db.chatSession.create({ data: { userId: user.id }, select: { id: true } }));
    redirect(`/chat/${session.id}`);
  }

  type Row = {
    id: string;
    title: string | null;
    updated_at: Date;
    message_count: number;
    excerpt: string | null;
  };

  const sessions: Row[] = query
    ? await db.$queryRaw<Row[]>`
        SELECT s.id, s.title, s.updated_at,
               (SELECT count(*)::int FROM chat_messages m WHERE m.session_id = s.id) AS message_count,
               /*
                * The line that matched, so a list of near-identical titles is
                * still readable. The student's own words come first: they are
                * what was searched for, and an assistant answer quoting the
                * term back is not evidence they asked about it.
                */
               (SELECT left(regexp_replace(m.content, '[[:space:]]+', ' ', 'g'), 120)
                  FROM chat_messages m
                 WHERE m.session_id = s.id
                   AND fold_arabic(m.content) ILIKE ${'%' + query + '%'}
                 ORDER BY (m.role = 'user') DESC, m.created_at ASC
                 LIMIT 1) AS excerpt
          FROM chat_sessions s
         WHERE s.user_id = ${user.id}::uuid
           AND (
             fold_arabic(coalesce(s.title, '')) ILIKE ${'%' + query + '%'}
             OR EXISTS (
               SELECT 1 FROM chat_messages m
                WHERE m.session_id = s.id
                  AND fold_arabic(m.content) ILIKE ${'%' + query + '%'}
             )
           )
         ORDER BY s.updated_at DESC
         LIMIT ${PAGE_SIZE}`
    : (
        await db.chatSession.findMany({
          where: { userId: user.id },
          select: {
            id: true,
            title: true,
            updatedAt: true,
            _count: { select: { messages: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: PAGE_SIZE,
        })
      ).map((s) => ({
        id: s.id,
        title: s.title,
        updated_at: s.updatedAt,
        message_count: s._count.messages,
        excerpt: null,
      }));

  /*
   * Only when there is nothing at all. A search that finds nothing must NOT
   * open a new conversation — the student asked to look something up, and
   * being dropped into an empty chat box reads as though their history had
   * been lost.
   */
  if (sessions.length === 0 && !query && isAiConfigured() && isEmbeddingConfigured()) {
    const session = await db.chatSession.create({ data: { userId: user.id }, select: { id: true } });
    redirect(`/chat/${session.id}`);
  }

  const configured = isAiConfigured() && isEmbeddingConfigured();

  const rows: ChatSessionRow[] = sessions.map((s) => ({
    id: s.id,
    title: s.title,
    updatedAt: s.updated_at.toISOString(),
    messageCount: s.message_count,
    excerpt: s.excerpt,
  }));
  const dateFor = Object.fromEntries(
    sessions.map((s) => [s.id, formatDate(locale, s.updated_at)]),
  );

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

      <Sheet>
        <SheetHeader title={t.chat.title} />
        <SheetBody className="p-0">
          <div className="px-5 py-4">
            {/* A plain GET form: the search is the URL, so it survives a
                refresh and the back button. */}
            <form method="get" className="flex flex-wrap items-end gap-3">
              <label className="block min-w-60 flex-1">
                <span className="sr-only">{t.chat.searchLabel}</span>
                <Input
                  type="search"
                  name="q"
                  defaultValue={query}
                  placeholder={t.chat.searchPlaceholder}
                />
              </label>
              <Button type="submit" variant="secondary" size="sm">
                {t.common.search}
              </Button>
            </form>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              tone="neutral"
              title={query ? t.chat.searchNoResults : t.chat.noSessions}
              body={query ? undefined : t.chat.noSessionsHint}
            />
          ) : (
            <SessionList sessions={rows} dateFor={dateFor} />
          )}
        </SheetBody>
      </Sheet>
    </>
  );
}
