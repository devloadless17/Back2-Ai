import type { Metadata, Viewport } from 'next';
import { Cairo, Inter } from 'next/font/google';

import { I18nProvider } from '@/lib/i18n/client';
import { dirFor, getDictionary, getLocale } from '@/lib/i18n';

import './globals.css';
import 'katex/dist/katex.min.css';

/**
 * Fonts are self-hosted by next/font rather than fetched from a CDN at runtime.
 * A student on a slow Beirut connection should not wait on fonts.googleapis.com
 * to see their own dashboard, and an exam runner must never depend on a third
 * party being reachable.
 *
 * Cairo carries both scripts: it has a real Arabic cut, so an Arabic-track
 * student gets the designed voice rather than a silent system substitution.
 */
const cairo = Cairo({
  subsets: ['latin', 'arabic'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-cairo',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

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
      className={`${cairo.variable} ${inter.variable}`}
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
