import type { Metadata } from 'next';
import Link from 'next/link';

import { LoginForm } from '@/components/auth/login-form';
import { Sheet, SheetBody } from '@/components/ui/sheet';
import { getTranslations } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t.auth.loginTitle };
}

export default async function LoginPage() {
  const { t } = await getTranslations();

  return (
    <Sheet>
      <SheetBody className="space-y-6 p-6 sm:p-8">
        <div className="space-y-1">
          <h1 className="text-2xl">{t.auth.loginTitle}</h1>
          <p className="text-sm text-ink-muted">{t.auth.loginSubtitle}</p>
        </div>

        <LoginForm />

        <p className="border-t border-rule pt-4 text-center text-[13px] text-ink-muted">
          {t.auth.noAccount}{' '}
          <Link href="/signup" className="font-medium text-primary underline-offset-2 hover:underline">
            {t.auth.createAccount}
          </Link>
        </p>
      </SheetBody>
    </Sheet>
  );
}
