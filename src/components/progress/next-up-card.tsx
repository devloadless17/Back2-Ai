import { LinkButton } from '@/components/ui/button';
import { Sheet, SheetBody } from '@/components/ui/sheet';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import type { NextUp } from '@/lib/queries/next-up';

/**
 * One instruction, one button.
 *
 * A server component on purpose: it holds no state, and the whole value of this
 * card is that it is the first thing painted rather than something that appears
 * after hydration. A student who opens the app to be told what to do should not
 * watch the answer arrive.
 */
export async function NextUpCard({ next }: { next: NextUp }) {
  const { t } = await getTranslations();

  const line =
    next.kind === 'flashcards'
      ? format(t.progress.nextUpDue, { count: next.count })
      : next.kind === 'weakChapter'
        ? format(t.progress.nextUpWeak, { chapter: next.chapterName })
        : next.kind === 'newChapter'
          ? `${t.progress.nextUpStart} — ${next.chapterName}`
          : next.kind === 'examSim'
            ? t.progress.nextUpPaper
            : t.progress.nextUpCaughtUp;

  const glyph =
    next.kind === 'flashcards'
      ? '◐'
      : next.kind === 'weakChapter'
        ? '◎'
        : next.kind === 'newChapter'
          ? '✦'
          : next.kind === 'examSim'
            ? '▣'
            : '✎';

  return (
    <Sheet hero className="overflow-hidden">
      <SheetBody className="flex flex-wrap items-center gap-4 p-5">
        <span
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 animate-float items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-2xl font-extrabold text-on-primary shadow-glow"
        >
          {glyph}
        </span>

        <div className="min-w-[12rem] flex-1">
          <p className="text-[11.5px] font-bold uppercase tracking-wider text-ink-faint">
            {t.progress.nextUp}
          </p>
          <p className="mt-0.5 text-[19px] font-extrabold leading-tight tracking-tight text-ink">
            {line}
          </p>
        </div>

        <LinkButton href={next.href} variant="primary" size="lg">
          {t.progress.nextUpAction} →
        </LinkButton>
      </SheetBody>
    </Sheet>
  );
}
