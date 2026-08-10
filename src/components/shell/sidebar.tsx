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
export function Sidebar({ user, counts }: { user: SidebarUser; counts: SidebarCounts }) {
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
        <Link href="/dashboard" className="font-serif text-base font-semibold">
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
          'transition-transform duration-200 ease-sheet lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0',
          // Logical transform: RTL slides in from the right, LTR from the left.
          open ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full lg:translate-x-0',
        )}
      >
        <div className="flex items-center justify-between border-b border-rule px-4 py-4">
          <Link href="/dashboard" className="min-w-0">
            <span className="block font-serif text-lg font-semibold leading-none">{t.common.appName}</span>
            {user.trackCode && (
              <span className="mt-1 block text-[11.5px] uppercase tracking-wide text-ink-faint">
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
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
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
        'group flex items-center gap-2.5 rounded px-3 py-2 text-[13.5px] transition-colors duration-150',
        active
          ? 'bg-primary-soft font-medium text-primary'
          : 'text-ink-muted hover:bg-paper-sunken hover:text-ink',
      )}
    >
      <Icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-primary' : 'text-ink-faint')} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="shrink-0 rounded-sm bg-mark px-1.5 py-0.5 text-[11px] font-semibold leading-none text-on-primary tabular-nums">
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
