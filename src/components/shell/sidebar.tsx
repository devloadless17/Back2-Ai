'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ComponentType } from 'react';

import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';

import {
  IconArchive,
  IconBell,
  IconCalendar,
  IconCamera,
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

export type SidebarLevel = {
  level: number;
  /** 0..1 through the current level. */
  progress: number;
  streak: number;
  /** 0..1 of today's question goal. */
  goalProgress: number;
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
  level,
}: {
  user: SidebarUser;
  counts: SidebarCounts;
  level: SidebarLevel;
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
        { href: '/flashcards', label: t.nav.flashcards, icon: IconCards, badge: counts.flashcardsDue },
        { href: '/chat', label: t.nav.chat, icon: IconChat },
        { href: '/upload', label: t.nav.upload, icon: IconCamera },
      ],
    },
    {
      label: t.nav.sections.assess,
      items: [
        { href: '/exam-sim', label: t.nav.examSim, icon: IconExam },
        { href: '/performance', label: t.nav.performance, icon: IconChart },
        { href: '/progress', label: t.progress.title, icon: IconTrophy },
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
        <Link href="/dashboard" className="text-base font-extrabold tracking-tight">
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
          'fixed inset-y-0 start-0 z-50 flex w-64 flex-col border-e border-rule bg-paper-raised/85 backdrop-blur-xl',
          'transition-transform duration-300 ease-spring lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0',
          // Logical transform: RTL slides in from the right, LTR from the left.
          open ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full lg:translate-x-0',
        )}
      >
        <div className="flex items-center justify-between border-b border-rule px-4 py-4">
          <Link href="/dashboard" className="group min-w-0">
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-[15px] font-extrabold text-on-primary shadow-pop transition-transform duration-300 ease-spring group-hover:rotate-6 group-hover:scale-110"
              >
                B
              </span>
              <span className="block text-lg font-extrabold leading-none tracking-tight">
                {t.common.appName}
              </span>
            </span>
            {user.trackCode && (
              <span className="mt-1.5 block ps-10 text-[11px] font-bold uppercase tracking-wider text-primary">
                {user.trackCode}
              </span>
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
              <p className="px-3 pb-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ink-faint">
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

        {/* Level, streak and today's goal, always in view.
            The bar is the reason this sits in the shell rather than on one
            page: a student should be able to see they are four questions off
            their goal from anywhere in the product. */}
        <Link
          href="/progress"
          className="group mx-3 mb-2 rounded-lg border border-rule bg-paper-sunken/60 px-3 py-2.5 transition-[transform,border-color,background-color] duration-200 ease-spring hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary-soft motion-reduce:transform-none motion-reduce:hover:transform-none"
        >
          <span className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-[13px] font-extrabold text-on-primary shadow-pop transition-transform duration-200 ease-spring group-hover:scale-110"
            >
              {level.level}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-extrabold uppercase tracking-wider text-ink-muted">
                  {t.progress.level} {level.level}
                </span>
                {level.streak > 0 && (
                  <span className="shrink-0 text-[11.5px] font-extrabold tabular-nums text-accent">
                    ▲ {level.streak}
                  </span>
                )}
              </span>

              {/* Two hairlines: progress through the level, and today's goal. */}
              <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-rule">
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-700 ease-soft"
                  style={{ width: `${Math.round(level.progress * 100)}%` }}
                />
              </span>
              <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-rule">
                <span
                  className="block h-full rounded-full bg-correct transition-[width] duration-700 ease-soft"
                  style={{ width: `${Math.round(level.goalProgress * 100)}%` }}
                />
              </span>
            </span>
          </span>
        </Link>

        <div className="border-t border-rule px-4 py-3">
          <p className="truncate text-[13px] font-medium text-ink">{user.displayName ?? user.email}</p>
          <p className="truncate text-[11.5px] text-ink-faint">{user.email}</p>
          <form action="/api/auth/logout" method="post" className="mt-2">
            <button
              type="submit"
              className="text-[12.5px] font-medium text-ink-muted underline-offset-2 hover:text-mark hover:underline"
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
        'group relative flex items-center gap-2.5 rounded-full px-3 py-2.5 text-[13.5px] font-semibold',
        'transition-[background-color,color,transform] duration-200 ease-spring',
        // The whole row slides a little on hover. It is a small thing, but a
        // sidebar that answers the pointer is what makes an app feel alive
        // rather than printed.
        'hover:translate-x-1 rtl:hover:-translate-x-1 motion-reduce:transform-none motion-reduce:hover:transform-none',
        active
          ? 'bg-gradient-to-r from-primary to-accent text-on-primary shadow-pop'
          : 'text-ink-muted hover:bg-primary-soft hover:text-primary',
      )}
    >
      <Icon
        className={cn(
          'h-[18px] w-[18px] shrink-0 transition-transform duration-200 ease-spring group-hover:scale-110',
          active ? 'text-on-primary' : 'text-ink-faint group-hover:text-primary',
        )}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-extrabold leading-none tabular-nums',
            active ? 'bg-on-primary/25 text-on-primary' : 'bg-accent text-on-primary',
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
