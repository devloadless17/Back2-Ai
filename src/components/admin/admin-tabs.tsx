'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';

export function AdminTabs() {
  const { t } = useI18n();
  const pathname = usePathname();

  const tabs = [
    { href: '/admin/review-queue', label: t.admin.reviewQueue },
    { href: '/admin/announcements', label: t.admin.announcements },
    { href: '/admin/ingestion', label: t.admin.ingestion },
    { href: '/admin/users', label: t.admin.users },
    { href: '/admin/audit', label: t.admin.audit },
  ];

  return (
    <nav className="scroll-x flex gap-1 border-b border-rule" aria-label={t.admin.title}>
      {tabs.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap border-b-2 px-3 py-2 text-[13.5px] font-medium transition-colors duration-150',
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-ink-muted hover:border-rule-strong hover:text-ink',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
