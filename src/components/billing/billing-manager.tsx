'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  CardFields,
  EMPTY_CARD,
  validateCard,
  type CardErrors,
  type CardFormState,
} from '@/components/billing/card-fields';
import { PlanPicker } from '@/components/billing/plan-picker';
import { Button } from '@/components/ui/button';
import { Alert, Badge } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { PAYMENTS_ENABLED, PLANS, type PlanId } from '@/lib/billing';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

export type BillingState = {
  plan: PlanId;
  status: 'pending' | 'active' | 'past_due' | 'canceled';
  cardBrand: string | null;
  cardLast4: string | null;
  cardExpMonth: number | null;
  cardExpYear: number | null;
};

/**
 * Plan and card, after signup.
 *
 * The stored card is shown as brand and last four because that is genuinely all
 * that is kept — the panel cannot show more, and a student who wonders what this
 * product knows about their card can read the answer off the screen.
 */
export function BillingManager({ initial }: { initial: BillingState }) {
  const { t, format } = useI18n();
  const router = useRouter();

  const [plan, setPlan] = useState<PlanId>(initial.plan);
  const [card, setCard] = useState<CardFormState>(EMPTY_CARD);
  const [editingCard, setEditingCard] = useState(false);
  const [cardErrors, setCardErrors] = useState<CardErrors>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const statusLabel: Record<BillingState['status'], string> = {
    pending: t.billing.statusPending,
    active: t.billing.statusActive,
    past_due: t.billing.statusPastDue,
    canceled: t.billing.statusCanceled,
  };

  async function save(options: { removeCard?: boolean } = {}) {
    setError(null);
    setSaved(null);
    setCardErrors({});

    let cardField: unknown;

    if (options.removeCard) {
      cardField = null;
    } else if (editingCard) {
      const validation = validateCard(card, {
        cardInvalid: t.billing.cardInvalid,
        cardholderRequired: t.billing.cardholderRequired,
        expiryInvalid: t.billing.expiryInvalid,
        securityCodeInvalid: t.billing.securityCodeInvalid,
      });
      if (!validation.summary) {
        setCardErrors(validation.errors);
        return;
      }
      cardField = validation.summary;
    }

    setSaving(true);
    try {
      await sendJson('/api/billing', 'PUT', {
        plan,
        ...(cardField === undefined ? {} : { card: cardField }),
      });
      setCard(EMPTY_CARD);
      setEditingCard(false);
      setSaved(options.removeCard ? t.billing.removed : t.billing.saved);
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    } finally {
      setSaving(false);
    }
  }

  const hasStoredCard = Boolean(initial.cardLast4);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Sheet>
        <SheetHeader title={t.billing.currentPlan} description={t.billing.subtitle} />
        <SheetBody className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge tone={initial.status === 'active' ? 'correct' : 'neutral'}>
              {statusLabel[initial.status]}
            </Badge>
          </div>

          <PlanPicker value={plan} onChange={setPlan} disabled={saving} />

          {PLANS[plan].requiresCard && !hasStoredCard && !editingCard && (
            <Alert tone="warning">{t.billing.noCard}</Alert>
          )}
        </SheetBody>
        <SheetFooter className="justify-end">
          <Button variant="primary" loading={saving} onClick={() => save()}>
            {t.common.save}
          </Button>
        </SheetFooter>
      </Sheet>

      <div className="space-y-5">
        <Sheet>
          <SheetHeader title={t.billing.paymentMethod} />
          <SheetBody className="space-y-4">
            {saved && <Alert tone="success">{saved}</Alert>}
            {error && <Alert tone="error">{error}</Alert>}

            {hasStoredCard && !editingCard ? (
              <div className="space-y-1">
                <p className="text-sm text-ink">
                  <span className="font-medium uppercase">{initial.cardBrand}</span>{' '}
                  {format(t.billing.endsIn, { last4: initial.cardLast4 ?? '' })}
                </p>
                {initial.cardExpMonth && initial.cardExpYear && (
                  <p className="text-[12.5px] text-ink-muted">
                    {format(t.billing.expiresOn, {
                      month: String(initial.cardExpMonth).padStart(2, '0'),
                      year: initial.cardExpYear,
                    })}
                  </p>
                )}
              </div>
            ) : editingCard ? (
              <CardFields value={card} onChange={setCard} errors={cardErrors} disabled={saving} />
            ) : (
              <p className="text-sm text-ink-muted">{t.billing.noCard}</p>
            )}

            {!PAYMENTS_ENABLED && (
              <Alert tone="info" title={t.billing.notConnected}>
                {t.billing.notConnectedBody}
              </Alert>
            )}
          </SheetBody>
          <SheetFooter className="justify-end gap-2">
            {hasStoredCard && !editingCard && (
              <Button disabled={saving} onClick={() => save({ removeCard: true })}>
                {t.billing.removeCard}
              </Button>
            )}
            {editingCard ? (
              <>
                <Button
                  disabled={saving}
                  onClick={() => {
                    setEditingCard(false);
                    setCard(EMPTY_CARD);
                    setCardErrors({});
                  }}
                >
                  {t.common.cancel}
                </Button>
                <Button variant="primary" loading={saving} onClick={() => save()}>
                  {t.billing.savePaymentMethod}
                </Button>
              </>
            ) : (
              <Button onClick={() => setEditingCard(true)} disabled={saving}>
                {hasStoredCard ? t.common.edit : t.billing.savePaymentMethod}
              </Button>
            )}
          </SheetFooter>
        </Sheet>
      </div>
    </div>
  );
}
