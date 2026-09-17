import { BandChip, bandForMastery, type Band } from '@/components/ui/band';
import { Meter } from '@/components/ui/progress';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { getTranslations } from '@/lib/i18n';
import type { ChapterProgress } from '@/lib/queries/progress';

/**
 * A ranked chapter list — weakest, or strongest.
 *
 * `/performance` carried this markup twice, identically, once for each list,
 * including the same explanatory comment copied into both. One component, two
 * call sites. The only real difference was the practise link, which belongs on
 * the weak list: telling a student to go and drill the chapter they are
 * already best at is not an instruction worth giving.
 *
 * The band chip names what the bar only shows. A meter on its own is a length:
 * a student reads "about a third" and has to guess whether that is bad.
 * `bandForMastery` is an existing product rule with settled cutoffs, used here
 * exactly as the dashboard and the chapter list use it — per chapter, against
 * evidence. It is not a new interpretation invented for this page.
 */
export async function ChapterRankList({
  title,
  chapters,
  withAction = false,
}: {
  title: string;
  chapters: ChapterProgress[];
  withAction?: boolean;
}) {
  const { t } = await getTranslations();

  const bandLabels: Record<Band, string> = {
    weak: t.dashboard.bandWeak,
    developing: t.dashboard.bandDeveloping,
    mastered: t.dashboard.bandMastered,
    not_started: t.dashboard.bandNotStarted,
    needs_review: t.dashboard.bandNeedsReview,
  };

  return (
    <Sheet>
      <SheetHeader title={title} />
      <SheetBody className="p-0">
        {chapters.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">{t.performance.noDataHint}</p>
        ) : (
          <ul className="ruled">
            {chapters.map((chapter) => {
              const band = bandForMastery(chapter.masteryScore, chapter.attemptsCount);
              return (
                <li key={chapter.chapterId} className="px-5 py-3">
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    {/* Chapter names wrap. Truncating one is how a student
                        ends up unable to tell two chapters apart, which is the
                        one thing this list exists to let them do. */}
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-ink">
                        {chapter.chapterName}
                      </p>
                      <p className="text-caption text-ink-faint">{chapter.subjectName}</p>
                    </div>

                    {withAction && (
                      <a
                        href={`/practice/${chapter.subjectId}/${chapter.chapterId}`}
                        className="shrink-0 text-meta font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {t.performance.practiseThis}
                      </a>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5">
                    <Meter
                      value={chapter.masteryScore}
                      size="sm"
                      caption={`${chapter.attemptsCount} ${t.practice.attempts}`}
                      className="min-w-0 flex-1"
                    />
                    <BandChip band={band} label={bandLabels[band]} className="shrink-0" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SheetBody>
    </Sheet>
  );
}
