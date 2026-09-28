'use client';

import { useState } from 'react';

import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';
import { THEME_COOKIE, type Theme } from '@/lib/theme';

/**
 * Light / dark, beside the language switch and built the same way.
 *
 * Unlike the language, nothing on screen was rendered from this on the server
 * except the attribute on <html>, so there is no refresh: the attribute flips
 * in place and every colour follows, because every colour is a token. The
 * cookie is for the next request, so the server stamps the same choice.
 */
export function ThemeSwitcher({ initial }: { initial: Theme }) {
  const { t } = useI18n();
  const [chosen, setChosen] = useState<Theme>(initial);

  function choose(next: Theme) {
    if (next === chosen) return;
    setChosen(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  const options: { value: Theme; label: string }[] = [
    { value: 'light', label: t.common.themeLight },
    { value: 'dark', label: t.common.themeDark },
  ];

  return (
    <div className="flex gap-1" role="group" aria-label={t.common.theme}>
      {options.map(({ value, label }) => {
        const active = value === chosen;
        return (
          <button
            key={value}
            type="button"
            onClick={() => choose(value)}
            aria-pressed={active}
            className={cn(
              'rounded px-2 py-1 text-caption font-medium transition-colors duration-150',
              active
                ? 'bg-primary-soft text-primary'
                : 'text-ink-faint hover:bg-paper-sunken hover:text-ink',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
