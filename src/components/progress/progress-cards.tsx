'use client';

import { RingGauge } from '@/components/ui/charts';
import { Badge } from '@/components/ui/feedback';
import { CountUp } from '@/components/ui/motion';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import type { BadgeKey, BadgeState, DailyGoal, LevelState, RankKey } from '@/lib/gamification';
import { useI18n } from '@/lib/i18n/client';

/**
 * The three cards that carry the progress layer.
 *
 * All of them are client components purely because their figures count up and
 * their rings draw in. Every number is rendered as text at its final value
 * first, so a student who never sees the animation sees the same information.
 */

// Roughly two minutes a question, which is what a mixed set actually takes.
const MINUTES_PER_QUESTION = 2;

export function LevelCard({
  level,
  rank,
  className,
}: {
  level: LevelState;
  rank: RankKey;
  className?: string;
}) {
  const { t, format } = useI18n();

  const rankLabel: Record<RankKey, string> = {
    beginner: t.progress.rankBeginner,
    apprentice: t.progress.rankApprentice,
    scholar: t.progress.rankScholar,
    expert: t.progress.rankExpert,
    master: t.progress.rankMaster,
  };

  const remaining = Math.max(0, level.xpForLevel - level.xpIntoLevel);

  return (
    <Sheet hero className={cn('overflow-hidden', className)}>
      <SheetBody className="flex items-center gap-5 p-5">
        {/* The level number sits inside its own progress ring, so "how far
            through this level am I" needs no second element to answer. */}
        <div className="relative shrink-0">
          <RingGauge
            value={level.progress}
            label=""
            size={104}
            tone="brand"
            className="[&_figcaption]:hidden"
          />
          <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
              {t.progress.level}
            </span>
            <span className="text-gradient text-[28px] font-extrabold leading-none tracking-tight">
              {level.level}
            </span>
          </span>
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <Badge tone="accent">{rankLabel[rank]}</Badge>

          <p className="text-[15px] font-extrabold tracking-tight text-ink">
            <CountUp value={level.totalXp} /> {t.progress.xp}
          </p>

          <p className="text-[12.5px] leading-snug text-ink-muted">
            {level.progress >= 1
              ? t.progress.maxLevel
              : format(t.progress.toNextLevel, { amount: remaining, level: level.level + 1 })}
          </p>
        </div>
      </SheetBody>
    </Sheet>
  );
}

export function DailyGoalCard({ goal, streak, className }: { goal: DailyGoal; streak: number; className?: string }) {
  const { t, format } = useI18n();
  const remaining = Math.max(0, goal.target - goal.done);

  return (
    <Sheet className={className}>
      <SheetHeader
        title={t.progress.dailyGoal}
        actions={
          streak > 0 ? (
            <Badge tone="accent">▲ {format(t.progress.streakReached, { days: streak })}</Badge>
          ) : null
        }
      />
      <SheetBody className="flex items-center gap-5">
        <RingGauge
          value={goal.progress}
          label=""
          size={104}
          tone={goal.met ? 'band' : 'brand'}
          className="shrink-0 [&_figcaption]:hidden"
        />

        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[15px] font-extrabold tracking-tight text-ink">
            {format(t.progress.dailyGoalHint, { done: goal.done, target: goal.target })}
          </p>
          <p className="text-[12.5px] leading-snug text-ink-muted">
            {goal.met
              ? t.progress.dailyGoalDone
              : format(t.progress.dailyGoalGo, {
                  remaining,
                  minutes: remaining * MINUTES_PER_QUESTION,
                })}
          </p>
        </div>
      </SheetBody>
    </Sheet>
  );
}

/**
 * The badge wall.
 *
 * Locked badges are shown, not hidden — greyed, with what they need and how
 * close you are. A badge you cannot see is not an incentive, and a row of
 * question marks is not either.
 */
export function BadgeGrid({ badges, className }: { badges: BadgeState[]; className?: string }) {
  const { t, format } = useI18n();

  const names = t.progress.badgeNames as Record<BadgeKey, string>;
  const hints = t.progress.badgeHints as Record<BadgeKey, string>;
  const earned = badges.filter((badge) => badge.earned).length;

  return (
    <Sheet className={className}>
      <SheetHeader
        title={t.progress.badges}
        description={format(t.progress.badgesEarned, { earned, total: badges.length })}
      />
      <SheetBody>
        <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {badges.map((badge) => (
            <li
              key={badge.key}
              className={cn(
                'flex items-start gap-3 rounded-lg border-2 p-3 transition-transform duration-200 ease-spring',
                'hover:-translate-y-1 motion-reduce:transform-none motion-reduce:hover:transform-none',
                badge.earned
                  ? 'border-accent/40 bg-accent-soft/50 shadow-pop'
                  : 'border-dashed border-rule bg-paper-sunken/40',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl font-extrabold',
                  badge.earned
                    ? 'animate-float bg-gradient-to-br from-primary to-accent text-on-primary'
                    : 'bg-paper-sunken text-ink-faint',
                )}
              >
                {badge.glyph}
              </span>

              <div className="min-w-0 flex-1 space-y-0.5">
                <p
                  className={cn(
                    'text-[13.5px] font-extrabold leading-tight tracking-tight',
                    badge.earned ? 'text-ink' : 'text-ink-muted',
                  )}
                >
                  {names[badge.key] ?? badge.key}
                </p>
                <p className="text-[12px] leading-snug text-ink-muted">{hints[badge.key] ?? ''}</p>

                {badge.earned ? (
                  <Badge tone="correct">{t.progress.badgeEarnedLabel}</Badge>
                ) : (
                  <p className="text-[11.5px] font-bold tabular-nums text-ink-faint">
                    {format(t.progress.badgeProgress, {
                      current: Math.floor(badge.current),
                      threshold: badge.threshold,
                    })}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </SheetBody>
    </Sheet>
  );
}
