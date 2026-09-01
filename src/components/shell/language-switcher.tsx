'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { cn } from '@/lib/cn';
import { LOCALE_COOKIE, LOCALE_LABELS, LOCALES, type Locale } from '@/lib/i18n/config';
import { useI18n } from '@/lib/i18n/client';

/**
 * Switches the language of the interface — and only of the interface.
 *
 * The distinction this rests on is the whole reason the control is allowed to
 * exist. A student's **study language** is locked at signup and stays locked:
 * it decides which subjects they have, which questions they are shown, and
 * which corpus every mastery figure was computed against. Nothing here touches
 * it. What changes is the **labels** — nav items, buttons, the words around the
 * numbers — which nothing is computed from and nothing is stored against.
 *
 * So a student sitting the French section can read their French chemistry under
 * Arabic menus and lose nothing at all. Their marks, their chapters and their
 * questions do not move, because every content query reads
 * `user.preferredLanguage` directly and none of them reads the interface
 * locale. See the note on `getLocale`.
 *
 * A cookie rather than a stored column, deliberately: this is a per-device
 * display preference, like the size of your browser text. Writing it to the
 * account would make it look like the locked one, which is the confusion the
 * whole design is trying to avoid.
 */
export function LanguageSwitcher() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<Locale>(locale);

  function choose(next: Locale) {
    if (next === chosen) return;
    setChosen(next);

    // Readable by the server on the next request, which is all it has to be —
    // there is nothing secret in "this person prefers Arabic menus", so it is
    // deliberately not an httpOnly cookie set through an endpoint.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;

    // Every label on screen was rendered on the server, so the page has to be
    // re-fetched rather than re-rendered. `startTransition` keeps the old text
    // visible while that happens instead of flashing an empty shell.
    startTransition(() => router.refresh());
  }

  return (
    <div
      className={cn('flex gap-1', pending && 'opacity-60')}
      role="group"
      aria-label={t.auth.language}
    >
      {LOCALES.map((code) => {
        const active = code === chosen;
        return (
          <button
            key={code}
            type="button"
            lang={code}
            onClick={() => choose(code)}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'rounded px-2 py-1 text-caption font-semibold transition-colors duration-150',
              active
                ? 'bg-primary-soft text-primary'
                : 'text-ink-faint hover:bg-paper-sunken hover:text-ink',
            )}
          >
            {LOCALE_LABELS[code]}
          </button>
        );
      })}
    </div>
  );
}
