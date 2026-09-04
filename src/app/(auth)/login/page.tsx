import type { Metadata } from 'next';
import Link from 'next/link';

import { LoginForm } from '@/components/auth/login-form';
import { getTranslations } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t.auth.loginTitle };
}

/**
 * Sign in.
 *
 * A two-column split: the brand panel on one side, the form on the other. The
 * panel is decoration and says so — it is `aria-hidden` and disappears entirely
 * below `lg`, where the form is the whole screen and a returning student on a
 * phone should meet the password field, not a poster.
 *
 * The mockup put a "3-day streak waiting for you" chip on that panel. It is not
 * here, and that is not an oversight: this page has no session, so there is no
 * streak to have. A specific number invented for a visitor we have not
 * identified is the exact opposite of what the rest of this product does with
 * figures, and it would be the first thing a returning student notices is a
 * lie. The panel keeps the sentiment and drops the number.
 */
export default async function LoginPage() {
  const { t } = await getTranslations();

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <section
        aria-hidden="true"
        className="hero-banner hidden flex-col justify-center rounded-none px-12 py-16 lg:flex"
      >
        <div className="relative z-[1] max-w-md">
          <p className="text-caption font-bold uppercase tracking-[0.08em] text-on-primary">
            {t.common.appName}
          </p>
          <p className="mt-4 font-display text-heading font-extrabold leading-snug text-on-primary">
            {t.marketing.loginQuote}
          </p>
          <p className="mt-3 text-body text-on-primary">{t.marketing.loginQuoteSub}</p>
        </div>
      </section>

      <div className="flex items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-sm space-y-6">
          <Link href="/" className="block text-body font-semibold">
            {t.common.appName}
          </Link>

          <div className="space-y-1">
            <h1 className="text-title font-semibold sm:text-heading">{t.auth.loginTitle}</h1>
            <p className="text-meta text-ink-muted">{t.auth.loginSubtitle}</p>
          </div>

          <LoginForm />

          {/* Below the form, not beside the password field: a student who has
              not tried yet does not need it, and one who has just failed is
              looking at the error, which is directly above this. */}
          <p className="text-center text-meta">
            <Link
              href="/forgot-password"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {t.auth.forgotLink}
            </Link>
          </p>

          <p className="border-t border-rule pt-4 text-center text-meta text-ink-muted">
            {t.auth.noAccount}{' '}
            <Link
              href="/signup"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {t.auth.createAccount}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
