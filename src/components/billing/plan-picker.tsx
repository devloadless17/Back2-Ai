'use client';

import { Badge } from '@/components/ui/feedback';
import { annualSavingPercent, PLANS, type PlanId } from '@/lib/billing';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';

/**
 * The three plans, as radio cards.
 *
 * Radios rather than a select: there are three, the price is part of the choice,
 * and a student comparing them should not have to open a menu to see the second
 * one. The free plan is listed first and is the default — while no processor is
 * connected it is also the honest one.
 *
 * `lockPaidPlans` is what both callers pass while nothing can be charged. The
 * paid rows stay on screen — a student deciding whether to start should be able
 * to see that paid tiers are coming — but they cannot be selected and they show
 * no price, because a price we cannot take is a price we should not print.
 *
 * A locked row that is nonetheless the account's current plan still renders
 * checked. Disabled and checked is the honest pair for "this is what you are
 * on, and it is not something you can pick here"; leaving it unchecked would
 * show a student on a monthly plan a picker with nothing selected at all.
 *
 * It stays a prop rather than a direct read of `PAYMENTS_ENABLED` so the switch
 * has exactly one owner. The callers decide; this component only draws.
 */
export function PlanPicker({
  value,
  onChange,
  disabled,
  lockPaidPlans = false,
  name = 'plan',
}: {
  value: PlanId;
  onChange: (plan: PlanId) => void;
  disabled?: boolean;
  lockPaidPlans?: boolean;
  name?: string;
}) {
  const { t, format } = useI18n();

  const labels: Record<PlanId, { title: string; hint: string; price: string }> = {
    free: { title: t.billing.planFree, hint: t.billing.planFreeHint, price: t.billing.priceFree },
    monthly: {
      title: t.billing.planMonthly,
      hint: t.billing.planMonthlyHint,
      price: `$${PLANS.monthly.priceUsd}${t.billing.perMonth}`,
    },
    annual: {
      title: t.billing.planAnnual,
      hint: t.billing.planAnnualHint,
      price: `$${PLANS.annual.priceUsd}${t.billing.perYear}`,
    },
  };

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-2 text-meta font-medium text-ink">{t.billing.choosePlan}</legend>

      {(Object.keys(labels) as PlanId[]).map((plan) => {
        const locked = lockPaidPlans && PLANS[plan].requiresCard;
        const selected = value === plan;

        return (
          <label
            key={plan}
            className={cn(
              'flex items-start gap-3 rounded border px-3 py-2.5 transition-colors duration-150',
              selected
                ? 'border-primary bg-primary-soft'
                : locked
                  ? 'border-rule bg-paper-sunken/50'
                  : 'border-rule-strong hover:bg-paper-sunken',
              locked ? 'cursor-not-allowed' : 'cursor-pointer',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <input
              type="radio"
              name={name}
              value={plan}
              checked={selected}
              disabled={locked}
              onChange={() => onChange(plan)}
              className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span
                  className={cn(
                    'text-sm font-medium',
                    locked && !selected ? 'text-ink-muted' : 'text-ink',
                  )}
                >
                  {labels[plan].title}
                </span>
                <span className="flex items-center gap-2">
                  {locked ? (
                    <Badge tone="neutral">{t.billing.planComingSoon}</Badge>
                  ) : (
                    <>
                      {plan === 'annual' && annualSavingPercent() > 0 && (
                        <Badge tone="correct">
                          {format(t.billing.saveAnnual, { percent: annualSavingPercent() })}
                        </Badge>
                      )}
                      <span className="text-meta font-semibold tabular-nums text-ink">
                        {labels[plan].price}
                      </span>
                    </>
                  )}
                </span>
              </span>
              <span className="mt-0.5 block text-meta leading-snug text-ink-muted">
                {locked ? t.billing.planComingSoonHint : labels[plan].hint}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
