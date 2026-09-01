'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ComponentType } from 'react';

import { cn } from '@/lib/cn';
import { LanguageSwitcher } from '@/components/shell/language-switcher';
import { useI18n } from '@/lib/i18n/client';

import {
  IconArchive,
  IconBell,
  IconCalendar,
  IconCards,
  IconChart,
  IconChat,
  IconCheckList,
  IconClose,
  IconDashboard,
  IconExam,
  IconMenu,
  IconPractice,
  IconSettings,
  IconShield,
  IconTrophy,
  IconBook,
} from './icons';

export type SidebarUser = {
  displayName: string | null;
  email: string;
  role: 'student' | 'admin';
  trackCode: string | null;
};

export type SidebarCounts = {
  flashcardsDue: number;
  unreadNotifications: number;
  pendingReview: number;
};

export type SidebarStanding = {
  /** Predicted mark out of 20. Null until there is enough marked work. */
  mark: number | null;
  scale: number;
  daysToExam: number | null;
};

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number;
};

/**
 * Primary navigation.
 *
 * Grouped by what the student is doing rather than by feature name — study,
 * assess, plan — because "flashcards" and "past papers" mean nothing to someone
 * looking for where to revise.
 *
 * The admin group is a UX convenience only. Every /admin route and every
 * /api/admin handler re-checks the role server-side; hiding these links is not
 * the security boundary.
 */
export function Sidebar({
  user,
  counts,
  standing,
}: {
  user: SidebarUser;
  counts: SidebarCounts;
  standing: SidebarStanding;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the drawer on navigation — otherwise it stays open over the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: t.nav.sections.study,
      items: [
        { href: '/practice', label: t.nav.practice, icon: IconPractice },
        { href: '/old-cycles', label: t.nav.oldCycles, icon: IconArchive },
        { href: '/summaries', label: t.nav.summaries, icon: IconBook },
        { href: '/flashcards', label: t.nav.flashcards, icon: IconCards, badge: counts.flashcardsDue },
        /*
         * One entry, not two.
         *
         * "Ask a question" and "Upload a photo" were separate destinations
         * because photo upload used to be its own page that ended by creating a
         * conversation. The chat composer takes an attachment directly now, so
         * two nav items pointed at the same activity and made a student choose
         * between them before knowing they were the same thing. /upload
         * redirects here.
         */
        { href: '/chat', label: t.nav.chat, icon: IconChat },
      ],
    },
    {
      label: t.nav.sections.assess,
      items: [
        { href: '/exam-sim', label: t.nav.examSim, icon: IconExam },
        { href: '/performance', label: t.nav.performance, icon: IconChart },
        /*
         * School marks. The page has existed at `/settings/grades` since it
         * was written and was reachable only by typing the URL — filed under
         * settings, where it reads as configuration rather than as something
         * a student does. It belongs beside the other things that tell them
         * how they are doing.
         */
        { href: '/settings/grades', label: t.nav.grades, icon: IconTrophy },
        { href: '/progress', label: t.standing.title, icon: IconTrophy },
      ],
    },
    {
      label: t.nav.sections.plan,
      items: [
        { href: '/schedule', label: t.nav.schedule, icon: IconCalendar },
        { href: '/todos', label: t.nav.todos, icon: IconCheckList },
      ],
    },
    {
      label: t.nav.sections.account,
      items: [
        {
          href: '/notifications',
          label: t.notifications.title,
          icon: IconBell,
          badge: counts.unreadNotifications,
        },
        { href: '/settings/profile', label: t.nav.settings, icon: IconSettings },
        ...(user.role === 'admin'
          ? [
              {
                href: '/admin/review-queue',
                label: t.nav.admin,
                icon: IconShield,
                badge: counts.pendingReview,
              },
            ]
          : []),
      ],
    },
  ];

  return (
    <>
      {/* Mobile bar. Hidden once the sidebar is permanent. */}
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-rule bg-paper-raised px-3 py-2 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded p-2 text-ink-muted hover:bg-paper-sunken hover:text-ink"
          aria-label={t.nav.dashboard}
          aria-expanded={open}
        >
          <IconMenu />
        </button>
        <Link href="/dashboard" className="text-body font-semibold">
          {t.common.appName}
        </Link>
      </div>

      {/* Scrim behind the mobile drawer. */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-ink/30 animate-fade-in lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-50 flex w-64 flex-col border-e border-rule bg-paper-raised',
          'transition-transform duration-200 ease-soft lg:sticky lg:top-0 lg:h-dvh',
          /*
           * Logical transform: RTL slides in from the right, LTR from the left.
           *
           * Scoped with `max-lg:` rather than reset with `lg:translate-x-0`,
           * and the difference is not cosmetic — it is why the sidebar was
           * invisible on every desktop. `ltr:` compiles to `[dir="ltr"] &`, an
           * attribute selector, so it outranks a plain `lg:` utility on
           * specificity no matter which is written last. The off-screen
           * transform therefore won at *every* width and the panel sat parked
           * outside the viewport. Applying the transform only below `lg` means
           * there is nothing to override above it, so no specificity contest
           * to lose.
           */
          open ? 'translate-x-0' : 'max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b border-rule px-4 py-4">
          <Link href="/dashboard" className="group min-w-0">
            <span className="block text-body font-semibold leading-none">{t.common.appName}</span>
            {user.trackCode && (
              <span className="label mt-1.5 block">{user.trackCode}</span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded p-1.5 text-ink-muted hover:bg-paper-sunken lg:hidden"
            aria-label={t.common.close}
          >
            <IconClose />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label={t.nav.dashboard}>
          <NavLink
            href="/dashboard"
            label={t.nav.dashboard}
            icon={IconDashboard}
            active={isActive(pathname, '/dashboard')}
          />

          {groups.map((group) => (
            <div key={group.label} className="mt-5">
              <p className="label px-3 pb-1.5">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      href={item.href}
                      label={item.label}
                      icon={item.icon}
                      badge={item.badge}
                      active={isActive(pathname, item.href)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/*
          The two figures a candidate checks constantly: what they are on now,
          and how long is left. No badge, no streak, no celebration — a mark out
          of 20 and a number of days are already meaningful to everyone who
          reads them.
        */}
        <Link
          href="/progress"
          className="mx-3 mb-2 block border-t border-rule pt-3 transition-colors duration-150 hover:bg-paper-sunken/60"
        >
          <span className="flex items-baseline justify-between gap-3 px-1">
            <span className="label">{t.standing.predictedMark}</span>
            <span className="figure text-body">
              {standing.mark === null ? '—' : `${standing.mark} / ${standing.scale}`}
            </span>
          </span>
          {standing.daysToExam !== null && (
            <span className="mt-1 flex items-baseline justify-between gap-3 px-1">
              <span className="label">{t.standing.daysLeft}</span>
              <span className="figure text-body">{standing.daysToExam}</span>
            </span>
          )}
        </Link>

        <div className="border-t border-rule px-4 py-3">
          <p className="truncate text-meta font-medium text-ink">{user.displayName ?? user.email}</p>
          <p className="truncate text-caption text-ink-faint">{user.email}</p>
          <div className="mt-2.5">
            <LanguageSwitcher />
          </div>

          <form action="/api/auth/logout" method="post" className="mt-2">
            <button
              type="submit"
              className="text-meta font-medium text-ink-muted underline-offset-2 hover:text-mark hover:underline"
            >
              {t.nav.logout}
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  badge,
  active,
}: {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-2.5 border-s-2 px-3 py-2 text-body',
        'transition-colors duration-150',
        active
          ? 'border-s-primary bg-primary-soft/60 font-semibold text-ink'
          : 'border-s-transparent text-ink-muted hover:bg-paper-sunken hover:text-ink',
      )}
    >
      <Icon
        className={cn(
          'h-[18px] w-[18px] shrink-0',
          active ? 'text-primary' : 'text-ink-faint',
        )}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            'shrink-0 rounded-sm border px-1.5 py-0.5 text-micro font-semibold leading-none tabular-nums',
            'border-rule-strong bg-paper-sunken text-ink-muted',
          )}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}

/** `/practice/xyz` should keep `/practice` highlighted; `/dashboard` matches only itself. */
function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}
