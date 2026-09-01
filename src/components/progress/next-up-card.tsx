import { LinkButton } from '@/components/ui/button';
import { Sheet, SheetBody } from '@/components/ui/sheet';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import type { NextUp } from '@/lib/queries/next-up';

/**
 * One instruction, one button.
 *
 * The commonest reason a revision session does not happen is opening the app,
 * seeing nine subjects and fifty-five chapters, and closing it again. This
 * picks the one thing worth doing next and names it.
 *
 * A server component on purpose: it holds no state, and the value of the card
 * is that it is painted with the page rather than arriving after hydration.
 */
export async function NextUpCard({ next }: { next: NextUp }) {
  const { t } = await getTranslations();

  const line =
    next.kind === 'flashcards'
      ? format(t.standing.nextUpDue, { count: next.count })
      : next.kind === 'weakChapter'
        ? format(t.standing.nextUpWeak, { chapter: next.chapterName })
        : next.kind === 'newChapter'
          ? `${t.standing.nextUpStart} — ${next.chapterName}`
          : next.kind === 'examSim'
            ? t.standing.nextUpPaper
            : t.standing.nextUpCaughtUp;

  return (
    <Sheet hero>
      <SheetBody className="flex flex-wrap items-center justify-between gap-4 py-3.5">
        <div className="min-w-[12rem] flex-1">
          <p className="label">{t.standing.nextUp}</p>
          <p className="mt-0.5 text-body font-medium leading-snug text-ink">{line}</p>
        </div>

        <LinkButton href={next.href} variant="primary" size="sm">
          {t.standing.nextUpAction}
        </LinkButton>
      </SheetBody>
    </Sheet>
  );
}
