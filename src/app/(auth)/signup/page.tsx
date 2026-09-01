import type { Metadata } from 'next';
import Link from 'next/link';

import { SignupForm } from '@/components/auth/signup-form';
import { EmptyState } from '@/components/ui/feedback';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t.auth.signupTitle };
}

/**
 * Create an account.
 *
 * One column, and no card around it. The wizard asks one question per screen
 * and already draws its own progress bar and step dots; wrapping that in a
 * sheet inside a narrow column made a screen holding a single text field look
 * like a form with something hidden below the fold. The page is the wizard.
 */
export default async function SignupPage() {
  const { t } = await getTranslations();

  const tracks = await db.track.findMany({
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 py-10 sm:px-6 sm:py-14">
      <Link href="/" className="mb-8 block text-body font-semibold">
        {t.common.appName}
      </Link>

      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-title font-semibold sm:text-heading">{t.auth.signupTitle}</h1>
          <p className="text-meta text-ink-muted">{t.auth.signupSubtitle}</p>
        </div>

        {tracks.length === 0 ? (
          // Signup is impossible without a track to lock the account to. Say so
          // plainly rather than rendering a form that cannot succeed.
          <EmptyState
            tone="pending"
            title="Configuration incomplète"
            body="Aucune série n’est encore enregistrée. Un administrateur doit charger le programme avant que des comptes puissent être créés."
          />
        ) : (
          <SignupForm tracks={tracks} />
        )}

        <p className="border-t border-rule pt-4 text-center text-meta text-ink-muted">
          {t.auth.alreadyHaveAccount}{' '}
          <Link href="/login" className="font-medium text-primary underline-offset-2 hover:underline">
            {t.auth.signIn}
          </Link>
        </p>
      </div>
    </div>
  );
}
