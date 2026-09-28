import type { Metadata, Viewport } from 'next';

import { I18nProvider } from '@/lib/i18n/client';
import { dirFor, getDictionary, getLocale } from '@/lib/i18n';
import { getTheme } from '@/lib/theme.server';

// Self-hosted, and vendored through npm rather than fetched at build time.
//
// These were `next/font/google`, which downloads the font files DURING the
// build: it fetches Google's stylesheet, pulls the file URLs out of it, and
// derives each file's extension with `/\.(woff|woff2|...)$/.exec(url)[1]`.
// Google does not answer every caller identically — from a GitHub Actions
// runner one of the Cairo URLs comes back in the legacy extensionless
// `/l/font?kit=` form, `exec` returns null, and the whole build dies on `[1]`.
// It never surfaced while this deployed on Vercel, where Next fetches from
// Vercel's own network, and it cannot be reproduced from a laptop.
//
// A build that reaches out to a third party is a build that fails for reasons
// nobody in this repo controls — which is the same argument the comment below
// already makes about runtime. These packages carry the identical Google
// subsets and unicode-ranges, so the browser still downloads only the scripts
// a page actually uses; the build just no longer asks anyone's permission.
import '@fontsource-variable/plus-jakarta-sans';
// Tajawal is not a variable font, so each weight is its own file. Only the
// three the design uses (400 lessons, 500 buttons and labels, 700 headings),
// and only the Arabic subset: Latin inside Arabic text falls through to
// Plus Jakarta Sans, so a formula in an Arabic paper matches the English one.
import '@fontsource/tajawal/arabic-400.css';
import '@fontsource/tajawal/arabic-500.css';
import '@fontsource/tajawal/arabic-700.css';

import './globals.css';
import 'katex/dist/katex.min.css';

/**
 * Fonts are self-hosted, so a student on a slow Beirut connection does not wait
 * on fonts.googleapis.com to see their own dashboard, and an exam runner never
 * depends on a third party being reachable. The families are wired to
 * --font-jakarta and --font-tajawal in globals.css.
 *
 * Plus Jakarta Sans carries English and French; Tajawal carries Arabic.
 * Weights are three and only three: 400 for reading, 500 for buttons and
 * labels, 700 for headings.
 */

export const metadata: Metadata = {
  title: {
    default: 'Bac II',
    template: '%s · Bac II',
  },
  description: 'Preparation for the Lebanese Baccalaureate, grounded in the official curriculum.',
  // This is a study tool holding student work; it has no business in search results.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#2563EB',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Root layout.
 *
 * Locale and direction are resolved server-side and stamped onto <html>, so the
 * first paint is already in the right language and the right direction. An
 * Arabic-track student must never see a flash of left-to-right layout.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const dictionary = getDictionary(locale);
  const dir = dirFor(locale);
  const theme = await getTheme();

  return (
    /*
     * `data-theme` is always stamped, never left to the device: the student's
     * choice from the theme switch (a cookie), or light when there is none.
     *
     * Light by default for a practical rather than aesthetic reason. This is shown on other
     * people's machines and projectors, where nobody controls the OS setting,
     * and a product that renders dark for half its audience is a product whose
     * screenshots and demo never match.
     */
    <html
      lang={locale}
      dir={dir}
      data-theme={theme}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-paper">
        <I18nProvider locale={locale} dictionary={dictionary}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
