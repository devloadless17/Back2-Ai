'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';

export function SettingsTabs() {
  const { t } = useI18n();
  const pathname = usePathname();

  const tabs = [
    { href: '/settings/profile', label: t.settings.profile },
    { href: '/settings/references', label: t.settings.references },
    { href: '/settings/grades', label: t.settings.grades },
    { href: '/settings/billing', label: t.settings.billing },
  ];

  return (
    <nav className="scroll-x flex gap-1 border-b border-rule" aria-label={t.settings.title}>
      {tabs.map((tab) => {
        const active = pathname === tab.href;
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
