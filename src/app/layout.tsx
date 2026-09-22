import type { Metadata, Viewport } from 'next';

import { I18nProvider } from '@/lib/i18n/client';
import { dirFor, getDictionary, getLocale } from '@/lib/i18n';

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
import '@fontsource-variable/cairo';
import '@fontsource-variable/inter';

import './globals.css';
import 'katex/dist/katex.min.css';

/**
 * Fonts are self-hosted, so a student on a slow Beirut connection does not wait
 * on fonts.googleapis.com to see their own dashboard, and an exam runner never
 * depends on a third party being reachable. The families are wired to
 * --font-cairo and --font-inter in globals.css.
 *
 * Cairo carries both scripts: it has a real Arabic cut, so an Arabic-track
 * student gets the designed voice rather than a silent system substitution.
 * Both are variable fonts, so every weight the design uses comes out of one
 * file per script instead of one file per weight.
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
  themeColor: '#5B4FE8',
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

  return (
    /*
     * `data-theme="light"` is stamped, not left to the device.
     *
     * The palette supports dark and the tokens are all defined for it, but the
     * dark rules are written as `:root:not([data-theme='light'])` inside a
     * `prefers-color-scheme` query — so pinning the attribute here switches the
     * whole product to light in one line and leaves that work intact for the
     * day a toggle is wanted.
     *
     * The reason is practical rather than aesthetic. This is shown on other
     * people's machines and projectors, where nobody controls the OS setting,
     * and a product that renders dark for half its audience is a product whose
     * screenshots and demo never match.
     */
    <html
      lang={locale}
      dir={dir}
      data-theme="light"
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
