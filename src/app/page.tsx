import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PreviewsSlot } from '@/components/marketing/previews-slot';
import { LinkButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/feedback';
import { Sheet, SheetBody } from '@/components/ui/sheet';
import { getSession } from '@/lib/auth/session';
import { getTranslations } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: { absolute: `${t.common.appName} — ${t.marketing.headline}` } };
}

/**
 * The front door.
 *
 * This page used to be a redirect, with a comment saying there was no marketing
 * page and the product was entered either signed in or at the sign-in form.
 * That is no longer true, and the redirect for a signed-in visitor is kept
 * precisely because it was the useful half of that rule: someone already
 * carrying a session wants their dashboard, not a sales pitch for a product
 * they have already bought into.
 *
 * Two constraints worth stating, because neither is visible from here:
 *
 *   The whole application is `noindex` at the root layout, on the grounds that
 *   a study tool holding student work has no business in search results. This
 *   page inherits that and is therefore shareable but not findable. Making the
 *   marketing page — and only the marketing page — indexable is a deliberate
 *   product decision that has not been taken, so it is not taken here.
 *
 *   Locale is a property of the account and there is no `[locale]` route. A
 *   signed-out visitor gets their cookie, then Accept-Language, then the
 *   default, exactly like the sign-in form does.
 */
export default async function RootPage() {
  const session = await getSession();
  if (session) redirect('/dashboard');

  const { t } = await getTranslations();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-5 sm:px-6 sm:pt-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <span className="text-body font-semibold">{t.common.appName}</span>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-meta font-semibold text-ink underline-offset-2 hover:underline"
          >
            {t.marketing.navLogin}
          </Link>
          <LinkButton href="/signup" variant="primary" size="sm">
            {t.marketing.navSignup}
          </LinkButton>
        </div>
      </header>

      {/* The same gradient banner the dashboard opens with, and for the same
          reason: it is wide, it holds few words, and every colour on it is set
          explicitly. It is the one gradient surface in the product and this is
          the second place it is allowed to appear. */}
      <section className="hero-banner mb-10 px-6 py-12 text-center sm:px-10 sm:py-16">
        <div className="relative z-[1] mx-auto max-w-2xl">
          <p className="text-caption font-bold uppercase tracking-[0.08em] text-on-primary">
            {t.marketing.eyebrow}
          </p>
          {/*
            The mockup sets the second line in amber. Measured against this
            gradient that is 2.86:1 at the indigo end and 1.44:1 at the violet
            one — under the 3.0 floor for large text everywhere on the banner,
            and 1.12:1 in dark mode, where the gradient itself is light. It also
            breaks the rule the palette states outright: the `-bright` cuts are
            for rings, chips and fills, where a shape carries the contrast, not
            for glyphs.

            So the emphasis moves off the letterforms and under them. The word
            stays white and fully legible; the amber is a rule beneath it, which
            is a shape, which is where amber is allowed to live.
          */}
          <h1 className="mt-3 font-display text-display font-extrabold text-on-primary sm:text-hero">
            {t.marketing.headline}
            <br />
            <span className="underline decoration-partial-bright decoration-4 underline-offset-[0.18em] sm:decoration-[6px]">
              {t.marketing.headlineAccent}
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-body text-on-primary">
            {t.marketing.subhead}
          </p>

          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-full bg-partial-bright px-5 py-3 text-body font-bold text-ink shadow-pop transition-transform duration-200 ease-soft hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:hover:transform-none"
            >
              {t.marketing.ctaStart}
              <span aria-hidden="true">→</span>
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center rounded-full border border-on-primary/40 bg-on-primary/15 px-5 py-3 text-body font-bold text-on-primary transition-colors duration-150 hover:bg-on-primary/25"
            >
              {t.marketing.ctaHaveAccount}
            </Link>
          </div>
        </div>
      </section>

      <section className="mb-12">
        <div className="mb-5 text-center">
          <h2 className="text-title font-semibold sm:text-heading">{t.marketing.previewTitle}</h2>
          <p className="mt-1 text-meta text-ink-muted">{t.marketing.previewSubtitle}</p>
        </div>

        <PreviewsSlot />

        <p className="mt-3 text-center text-caption text-ink-faint">
          {t.marketing.previewNothingSaved}
        </p>
      </section>

      {/* The one claim this product actually competes on, so it is stated
          plainly rather than dressed up as a logo wall we do not have. */}
      <p className="mx-auto mb-12 max-w-2xl text-center text-meta leading-relaxed text-ink-muted">
        {t.marketing.trustLine}
      </p>

      <section>
        <h2 className="mb-4 text-center text-title font-semibold sm:text-heading">
          {t.marketing.pricingTitle}
        </h2>

        <Sheet className="mx-auto max-w-md">
          <SheetBody className="space-y-3 p-6 text-center">
            <Badge tone="partial">{t.marketing.pricingBadge}</Badge>
            <h3 className="text-lead font-semibold">{t.marketing.pricingHeading}</h3>
            <p className="text-meta leading-relaxed text-ink-muted">{t.marketing.pricingBody}</p>
            <LinkButton href="/signup" variant="primary" size="lg" fullWidth>
              {t.marketing.pricingCta}
            </LinkButton>
          </SheetBody>
        </Sheet>
      </section>
    </div>
  );
}
