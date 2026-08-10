import type { Metadata } from 'next';
import Link from 'next/link';

import { SignupForm } from '@/components/auth/signup-form';
import { EmptyState } from '@/components/ui/feedback';
import { Sheet, SheetBody } from '@/components/ui/sheet';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t.auth.signupTitle };
}

export default async function SignupPage() {
  const { t } = await getTranslations();

  const tracks = await db.track.findMany({
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });

  return (
    <Sheet>
      <SheetBody className="space-y-6 p-6 sm:p-8">
        <div className="space-y-1">
          <h1 className="text-2xl">{t.auth.signupTitle}</h1>
          <p className="text-sm text-ink-muted">{t.auth.signupSubtitle}</p>
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

        <p className="border-t border-rule pt-4 text-center text-[13px] text-ink-muted">
          {t.auth.alreadyHaveAccount}{' '}
          <Link href="/login" className="font-medium text-primary underline-offset-2 hover:underline">
            {t.auth.signIn}
          </Link>
        </p>
      </SheetBody>
    </Sheet>
  );
}
