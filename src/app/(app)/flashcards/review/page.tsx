import type { Metadata } from 'next';

import { ReviewSession } from '@/components/flashcards/review-session';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import { getDueCards, weakChapters, type ReviewScope } from '@/lib/queries/flashcards';
import { MIN_ATTEMPTS_FOR_WEAKNESS } from '@/lib/scoring/mastery';

export const metadata: Metadata = { title: 'Review' };

/**
 * A review sitting.
 *
 * The whole due set is loaded once and reviewed client-side, with each grade
 * posted as it happens. A student on a patchy connection should be able to work
 * through their cards without a round-trip between every single one.
 *
 * The weak-spots scope has its own empty state: an ordinary empty deck means
 * "you are caught up", but an empty *weak* session means "we do not know you
 * well enough yet", and congratulating someone for the second is misleading.
 */
export default async function FlashcardReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; id?: string }>;
}) {
  const { scope: scopeParam, id } = await searchParams;
  const user = await requireUser();
  const { t } = await getTranslations();

  const scope: ReviewScope =
    scopeParam === 'chapter' && id
      ? { kind: 'chapter', chapterId: id }
      : scopeParam === 'unit' && id
        ? { kind: 'unit', unitId: id }
        : scopeParam === 'subject' && id
          ? { kind: 'subject', subjectId: id }
          : scopeParam === 'weak'
            ? { kind: 'weak' }
            : { kind: 'all' };

  const isWeakScope = scope.kind === 'weak';

  if (isWeakScope) {
    const chapters = await weakChapters(user.id, user.trackId);

    if (chapters.length === 0) {
      return (
        <>
          <PageHeader title={t.flashcards.scopeWeak} description={t.flashcards.scopeWeakHint} />
          <EmptyState
            tone="pending"
            title={t.flashcards.weakNone}
            body={format(t.flashcards.weakNoneHint, { count: MIN_ATTEMPTS_FOR_WEAKNESS })}
            action={
              <LinkButton href="/practice" variant="primary">
                {t.dashboard.noActivityCta}
              </LinkButton>
            }
          />
        </>
      );
    }
  }

  const cards = await getDueCards(user.id, user.trackId, scope);

  return (
    <>
      <PageHeader
        title={isWeakScope ? t.flashcards.scopeWeak : t.flashcards.title}
        description={isWeakScope ? t.flashcards.scopeWeakHint : t.flashcards.subtitle}
      />
      <ReviewSession cards={cards} />
    </>
  );
}
