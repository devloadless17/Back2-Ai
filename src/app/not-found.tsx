import Link from 'next/link';

import { getTranslations } from '@/lib/i18n';

export default async function NotFound() {
  const { t } = await getTranslations();

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-heading font-semibold tracking-tight">{t.errors.notFound}</h1>
        <p className="text-sm text-ink-muted">{t.errors.notFoundBody}</p>
        <Link
          href="/dashboard"
          className="inline-block text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          {t.errors.goHome}
        </Link>
      </div>
    </div>
  );
}
