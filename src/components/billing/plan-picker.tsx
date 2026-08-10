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
 */
export function PlanPicker({
  value,
  onChange,
  disabled,
  name = 'plan',
}: {
  value: PlanId;
  onChange: (plan: PlanId) => void;
  disabled?: boolean;
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
      <legend className="mb-2 text-[13px] font-medium text-ink">{t.billing.choosePlan}</legend>

      {(Object.keys(labels) as PlanId[]).map((plan) => {
        const selected = value === plan;
        return (
          <label
            key={plan}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded border px-3 py-2.5 transition-colors duration-150',
              selected ? 'border-primary bg-primary-soft' : 'border-rule-strong hover:bg-paper-sunken',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <input
              type="radio"
              name={name}
              value={plan}
              checked={selected}
              onChange={() => onChange(plan)}
              className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-medium text-ink">{labels[plan].title}</span>
                <span className="flex items-center gap-2">
                  {plan === 'annual' && annualSavingPercent() > 0 && (
                    <Badge tone="correct">
                      {format(t.billing.saveAnnual, { percent: annualSavingPercent() })}
                    </Badge>
                  )}
                  <span className="text-[13px] font-semibold tabular-nums text-ink">
                    {labels[plan].price}
                  </span>
                </span>
              </span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-muted">
                {labels[plan].hint}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
