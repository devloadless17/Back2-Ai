import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { getTranslations } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t.auth.forgotTitle };
}

/**
 * Asking for a password reset link.
 *
 * Signed out, so it lives in the `(auth)` group and never renders the app
 * shell. Someone who cannot get in must not be shown a sidebar of things they
 * cannot reach.
 */
export default async function ForgotPasswordPage() {
  const { t } = await getTranslations();

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12 sm:px-6">
      <div className="w-full max-w-sm space-y-6">
        <Link href="/" className="block text-body font-semibold">
          {t.common.appName}
        </Link>

        <div className="space-y-1">
          <h1 className="text-title font-semibold sm:text-heading">{t.auth.forgotTitle}</h1>
          <p className="text-meta text-ink-muted">{t.auth.forgotSubtitle}</p>
        </div>

        {/* The form reads the token from the query string, which needs a
            Suspense boundary — `useSearchParams` opts the tree into client
            rendering and Next requires the boundary to be explicit. */}
        <Suspense fallback={null}>
          <ForgotPasswordForm />
        </Suspense>

        <p className="border-t border-rule pt-4 text-center text-meta text-ink-muted">
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {t.auth.signIn}
          </Link>
        </p>
      </div>
    </div>
  );
}
