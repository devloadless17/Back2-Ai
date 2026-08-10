import type { Metadata, Viewport } from 'next';

import { I18nProvider } from '@/lib/i18n/client';
import { dirFor, getDictionary, getLocale } from '@/lib/i18n';

import './globals.css';
import 'katex/dist/katex.min.css';

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
  themeColor: '#0f1729',
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
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className="min-h-dvh bg-paper">
        <I18nProvider locale={locale} dictionary={dictionary}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
