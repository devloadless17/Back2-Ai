import type { Metadata } from 'next';

import { BillingManager, type BillingState } from '@/components/billing/billing-manager';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t.billing.title };
}

/**
 * Billing.
 *
 * Accounts created before this table existed are backfilled by the migration, so
 * a missing row would mean something went wrong rather than "not set up yet".
 * The fallback below is the same free/pending state that backfill writes, which
 * keeps the page usable instead of erroring at a student.
 */
export default async function BillingSettingsPage() {
  const user = await requireUser();

  const subscription = await db.subscription.findUnique({
    where: { userId: user.id },
    select: {
      plan: true,
      status: true,
      cardBrand: true,
      cardLast4: true,
      cardExpMonth: true,
      cardExpYear: true,
    },
  });

  const initial: BillingState = {
    plan: subscription?.plan ?? 'free',
    status: subscription?.status ?? 'pending',
    cardBrand: subscription?.cardBrand ?? null,
    cardLast4: subscription?.cardLast4 ?? null,
    cardExpMonth: subscription?.cardExpMonth ?? null,
    cardExpYear: subscription?.cardExpYear ?? null,
  };

  return <BillingManager initial={initial} />;
}
