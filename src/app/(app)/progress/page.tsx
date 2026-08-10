import type { Metadata } from 'next';

import { BadgeGrid, DailyGoalCard, LevelCard } from '@/components/progress/progress-cards';
import { LinkButton } from '@/components/ui/button';
import { ActivityColumns } from '@/components/ui/charts';
import { Badge } from '@/components/ui/feedback';
import { Reveal } from '@/components/ui/motion';
import { PageHeader, Sheet, SheetBody, SheetHeader, StatTile } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { getTranslations } from '@/lib/i18n';
import { format, formatDate } from '@/lib/i18n/format';
import { attemptsByDay } from '@/lib/queries/activity';
import { getProgressSnapshot } from '@/lib/queries/gamification';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t.progress.title };
}

/**
 * Everything the motivational layer knows, on one page.
 *
 * This is deliberately separate from `/performance`. Performance answers "am I
 * ready for the exam" and is allowed to deliver bad news; this page answers
 * "have I been putting the work in" and is allowed to be encouraging. Mixing
 * them produces a screen that congratulates a student on a thirty-day streak
 * immediately above a readiness score of 34%, which helps nobody.
 */
export default async function ProgressPage() {
  const user = await requireUser();
  const { locale, t } = await getTranslations();

  const [snapshot, activity] = await Promise.all([
    getProgressSnapshot(user.id),
    attemptsByDay(user.id, 28),
  ]);

  const earned = snapshot.badges.filter((badge) => badge.earned).length;
  const badgeNames = t.progress.badgeNames as Record<string, string>;

  return (
    <>
      <PageHeader
        title={t.progress.title}
        description={t.progress.subtitle}
        actions={
          <LinkButton href="/practice" variant="primary">
            {t.progress.nextUpAction}
          </LinkButton>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Reveal index={0}>
          <LevelCard level={snapshot.levelState} rank={snapshot.rank} className="h-full" />
        </Reveal>
        <Reveal index={1}>
          <DailyGoalCard goal={snapshot.goal} streak={snapshot.streak} className="h-full" />
        </Reveal>
      </div>

      <div className="stagger mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t.dashboard.attemptsTotal}
          value={snapshot.stats.attempts}
          caption={t.dashboard.attemptsTotalHint}
          icon="✎"
        />
        <StatTile
          label={t.dashboard.streak}
          value={snapshot.streak}
          caption={t.dashboard.streakHint}
          tone="accent"
          icon="▲"
        />
        <StatTile
          label={t.progress.badges}
          value={earned}
          caption={format(t.progress.badgesEarned, { earned, total: snapshot.badges.length })}
          icon="★"
        />
        <StatTile
          label={t.progress.xp}
          value={snapshot.levelState.totalXp}
          caption={format(t.progress.xpTotal, { amount: snapshot.levelState.totalXp })}
          tone="accent"
          icon="✦"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Reveal index={0} className="lg:col-span-2">
          <Sheet className="h-full">
            <SheetHeader title={t.dashboard.activity} description={t.dashboard.activityHint} />
            <SheetBody>
              <ActivityColumns
                data={activity.map((day) => ({
                  id: day.date.toISOString(),
                  label: formatDate(locale, day.date, { day: 'numeric', month: 'short' }),
                  value: day.count,
                  caption: formatDate(locale, day.date, { weekday: 'short', day: 'numeric' }),
                }))}
                emptyLabel={t.dashboard.activityEmpty}
              />
            </SheetBody>
          </Sheet>
        </Reveal>

        <Reveal index={1}>
          <Sheet className="h-full">
            <SheetHeader title={t.progress.nextBadge} />
            <SheetBody className="space-y-3">
              {snapshot.next ? (
                <>
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-12 w-12 shrink-0 animate-float items-center justify-center rounded-full bg-primary-soft text-2xl font-extrabold text-primary"
                    >
                      {snapshot.next.glyph}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-extrabold tracking-tight text-ink">
                        {badgeNames[snapshot.next.key] ?? snapshot.next.key}
                      </p>
                      <p className="text-[12.5px] tabular-nums text-ink-muted">
                        {format(t.progress.badgeProgress, {
                          current: Math.floor(snapshot.next.current),
                          threshold: snapshot.next.threshold,
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-paper-sunken">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-[900ms] ease-soft"
                      style={{ width: `${Math.round(snapshot.next.progress * 100)}%` }}
                    />
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-4 text-center">
                  <span aria-hidden="true" className="animate-float text-4xl">
                    ♔
                  </span>
                  <Badge tone="correct">{t.progress.badgeEarnedLabel}</Badge>
                </div>
              )}
            </SheetBody>
          </Sheet>
        </Reveal>
      </div>

      <Reveal className="mt-5 block">
        <BadgeGrid badges={snapshot.badges} />
      </Reveal>
    </>
  );
}
