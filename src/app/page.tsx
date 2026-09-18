import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PreviewsSlot } from '@/components/marketing/previews-slot';
import { SiteHeader } from '@/components/marketing/site-header';
import {
  ExaminerFragment,
  MarksLostFragment,
  NextMoveFragment,
  NourFragment,
  NourMark,
  QuestionFragment,
  ReadinessFragment,
  Surface,
} from '@/components/marketing/surfaces';
import { getSession } from '@/lib/auth/session';
import { cn } from '@/lib/cn';
import { getTranslations } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return {
    title: { absolute: `${t.common.appName} — ${t.marketing.headline} ${t.marketing.headlineAccent}` },
    description: t.marketing.subhead,
  };
}

/**
 * The front door.
 *
 * Two constraints carried over from the page this replaces, because neither is
 * visible from here and both are still true:
 *
 *   A signed-in visitor is redirected. Someone already carrying a session
 *   wants their dashboard, not a sales pitch for a product they have bought
 *   into.
 *
 *   The whole application is `noindex` at the root layout, on the grounds that
 *   a study tool holding student work has no business in search results. This
 *   page inherits that and is therefore shareable but not findable. Making the
 *   marketing page — and only the marketing page — indexable is a product
 *   decision that has not been taken, so it is not taken here.
 *
 * WHAT THIS PAGE ARGUES, in order: this is for your exam specifically; here is
 * the corpus behind that claim; here is the product doing the four things that
 * matter; here is why the answers can be trusted; here is the loop they form.
 * Each section is one idea with one product surface beside it. There is no
 * feature grid, because a grid says "many things" where this product's case is
 * "the right things, connected".
 *
 * Every figure in the product fragments is illustrative and says so where it
 * could be mistaken for a real student's. The corpus numbers in the proof strip
 * are the ones measured in this repository.
 */
export default async function RootPage() {
  const session = await getSession();
  if (session) redirect('/dashboard');

  const { t } = await getTranslations();
  const m = t.marketing;

  const nav = [
    { href: '#how', label: m.navHow },
    { href: '#features', label: m.navFeatures },
    { href: '#bac', label: m.navBac },
    { href: '#pricing', label: m.navPricing },
  ];

  return (
    <div className="bg-paper">
      <SiteHeader
        brand={t.common.appName}
        nav={nav}
        signIn={m.navLogin}
        start={m.ctaStart}
        menuLabel={m.navMenu}
      />

      <main>
        {/* ================= HERO ================= */}
        <section className="relative overflow-hidden border-b border-rule">
          {/*
            Atmosphere, not decoration. A single very pale mint wash off the
            top-inline corner and a faint academic rule grid — enough to stop
            the fold reading as a blank document, far short of a gradient.
            Both are `aria-hidden` and neither moves.
          */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_75%_0%,hsl(var(--primary-soft))_0%,transparent_70%)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(hsl(var(--rule))_1px,transparent_1px)] [background-size:100%_2.25rem]"
          />

          <div className="relative mx-auto w-full max-w-[1180px] px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-20 lg:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
              <div className="max-w-xl">
                <p className="text-micro font-semibold uppercase tracking-[0.14em] text-primary">
                  {m.eyebrow}
                </p>

                {/*
                  The one place on the site with display type. Two short lines:
                  the exam, then the promise. The second line carries the mint
                  because that is the word the page is actually selling.
                */}
                <h1 className="mt-5 font-display text-[2.25rem] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[3rem] lg:text-[3.5rem]">
                  {m.headline}
                  <br />
                  <span className="text-primary">{m.headlineAccent}</span>
                </h1>

                <p className="mt-5 max-w-prose text-lead leading-relaxed text-ink-muted">
                  {m.subhead}
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link
                    href="/signup"
                    className="inline-flex min-h-12 items-center gap-2 rounded-sm bg-primary px-6 text-body font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {m.finalCta}
                    <span aria-hidden>→</span>
                  </Link>
                  <Link
                    href="#how"
                    className="inline-flex min-h-12 items-center rounded-sm border border-rule-strong px-6 text-body font-medium text-ink transition-colors hover:bg-paper-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {m.ctaSeeHow}
                  </Link>
                </div>
              </div>

              {/*
                THE PRODUCT IS THE HERO IMAGE.

                Three real surfaces, overlapped rather than stacked, with the
                marked paper in front because "it marks you like the exam" is
                the claim that separates this from a chatbot. Depth comes from
                the overlap and one hairline each — nothing glows.

                On a phone the stack becomes one column in reading order: the
                mark first, then Nour, and the next-move card is dropped
                entirely rather than shrunk into an unreadable chip.
              */}
              <div className="relative">
                <div className="space-y-4 lg:space-y-0">
                  <ExaminerFragment
                    className="relative z-20 lg:max-w-[26rem]"
                    labels={{
                      title: m.examinerLabel,
                      nourNote: m.examinerNourNote,
                      note: m.examinerNote,
                    }}
                  />

                  <NourFragment
                    className="relative z-10 lg:-mt-6 lg:ms-16 lg:max-w-[27rem]"
                    labels={{
                      name: m.nourName,
                      question: m.nourQuestion,
                      answer: m.nourAnswer,
                      grounded: m.nourGrounded,
                    }}
                  />

                  <NextMoveFragment
                    className="hidden lg:relative lg:z-20 lg:-mt-4 lg:block lg:max-w-[22rem]"
                    labels={{
                      eyebrow: m.nextMoveEyebrow,
                      subject: m.nextMoveSubject,
                      chapter: m.nextMoveChapter,
                      reason: m.nextMoveReason,
                      cta: m.nextMoveCta,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ================= PROOF ================= */}
        {/*
          Editorial, not four KPI cards. Large figures, thin rules between, and
          the claim under each one in sentence case. These are the numbers this
          repository actually measures.
        */}
        <section className="border-b border-rule">
          <div className="mx-auto w-full max-w-[1180px] px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-9 sm:gap-x-10 lg:grid-cols-4 lg:divide-x lg:divide-rule">
              {[
                { v: m.proofYearsValue, l: m.proofYears },
                { v: m.proofQuestionsValue, l: m.proofQuestions },
                { v: m.proofChaptersValue, l: m.proofChapters },
                { v: m.proofOfficialValue, l: m.proofOfficial },
              ].map((item, i) => (
                <div key={item.l} className={cn('min-w-0', i > 0 && 'lg:ps-10')}>
                  <dt className="figure text-title leading-none text-ink sm:text-heading">
                    {item.v}
                  </dt>
                  <dd className="mt-2 text-meta leading-snug text-ink-muted">{item.l}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ================= PRACTICE ================= */}
        <Story
          id="features"
          title={m.practiceTitle}
          body={m.practiceBody}
          surface={
            <QuestionFragment
              labels={{
                subject: m.practiceSubject,
                chapter: m.practiceChapter,
                provenance: m.practiceProvenance,
                marks: m.practiceMarks,
              }}
              body={m.practiceQuestion}
              bodyLang="en"
            />
          }
        />

        {/* ================= EXAMINER ================= */}
        {/*
          The contrasting section. Warm near-black rather than pure black, mint
          kept for the one accent, and the marked paper sitting on it at full
          size — this is the feature the page is built around, so it is the
          only section that changes the colour of the room.
        */}
        <section className="border-y border-rule bg-ink text-paper">
          <div className="mx-auto grid w-full max-w-[1180px] items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-16 lg:px-8">
            <div className="max-w-xl">
              <h2 className="font-display text-heading font-semibold leading-tight tracking-tight sm:text-display">
                {m.examinerTitle}
                <br />
                <span className="text-correct-bright">{m.examinerTitleAccent}</span>
              </h2>
              <p className="mt-5 max-w-prose text-body leading-relaxed text-paper/75">
                {m.examinerBody}
              </p>
            </div>
            <ExaminerFragment
              className="lg:justify-self-end lg:max-w-[28rem]"
              labels={{
                title: m.examinerLabel,
                nourNote: m.examinerNourNote,
                note: m.examinerNote,
              }}
            />
          </div>
        </section>

        {/* ================= NOUR ================= */}
        <section className="border-b border-rule bg-primary-soft/40">
          <div className="mx-auto grid w-full max-w-[1180px] items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-16 lg:px-8">
            <NourFragment
              className="order-2 lg:order-1 lg:max-w-[30rem]"
              labels={{
                name: m.nourName,
                question: m.nourQuestion,
                answer: m.nourAnswer,
                grounded: m.nourGrounded,
              }}
            />
            <div className="order-1 max-w-xl lg:order-2">
              <NourMark className="mb-5 size-9" />
              <h2 className="font-display text-heading font-semibold leading-tight tracking-tight text-ink sm:text-display">
                {m.nourTitle}
                <br />
                <span className="text-primary">{m.nourTitleAccent}</span>
              </h2>
              <p className="mt-5 max-w-prose text-body leading-relaxed text-ink-muted">
                {m.nourBody}
              </p>
              <p className="mt-6 border-s-2 border-primary ps-4 text-meta leading-relaxed text-ink">
                {m.evidenceBody}
              </p>
            </div>
          </div>
        </section>

        {/* ================= PROGRESS ================= */}
        <Story
          title={m.progressTitle}
          titleAccent={m.progressTitleAccent}
          body={m.progressBody}
          reverse
          surface={
            <div className="space-y-4">
              <ReadinessFragment
                labels={{
                  eyebrow: m.readinessEyebrow,
                  readiness: m.readinessCaption,
                  mastery: m.masteryLabel,
                  practised: m.practisedLabel,
                  evidence: m.evidenceLabel,
                  evidenceValue: m.evidenceValue,
                  illustrative: m.illustrative,
                }}
              />
              <MarksLostFragment
                labels={{
                  eyebrow: m.marksLostEyebrow,
                  rows: [
                    { criterion: m.marksLost1, count: m.marksLost1Count },
                    { criterion: m.marksLost2, count: m.marksLost2Count },
                    { criterion: m.marksLost3, count: m.marksLost3Count },
                  ],
                  illustrative: m.illustrative,
                }}
              />
            </div>
          }
        />

        {/* ================= NEXT MOVE ================= */}
        <Story
          title={m.nextMoveTitle}
          titleAccent={m.nextMoveTitleAccent}
          body={m.nextMoveBody}
          surface={
            <NextMoveFragment
              labels={{
                eyebrow: m.nextMoveEyebrow,
                subject: m.nextMoveSubject,
                chapter: m.nextMoveChapter,
                reason: m.nextMoveReason,
                cta: m.nextMoveCta,
              }}
            />
          }
        />

        {/* ================= LEBANESE BAC IDENTITY ================= */}
        {/*
          The section that earns the word "Lebanese". Not a flag — the tracks
          by name, the three languages of instruction, and three real academic
          lines each sitting in its own direction inside an interface that does
          not move. That last part IS the argument.
        */}
        <section id="bac" className="border-b border-rule bg-paper-sunken">
          <div className="mx-auto w-full max-w-[1180px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <div className="max-w-2xl">
              <h2 className="font-display text-heading font-semibold leading-tight tracking-tight text-ink sm:text-display">
                {m.bacTitle}
                <br />
                <span className="text-primary">{m.bacTitleAccent}</span>
              </h2>
              <p className="mt-5 max-w-prose text-body leading-relaxed text-ink-muted">{m.bacBody}</p>
            </div>

            <div className="mt-10 flex flex-wrap items-baseline gap-x-10 gap-y-4 border-y border-rule py-5">
              <p className="text-micro font-semibold uppercase tracking-[0.12em] text-ink-faint">
                {m.tracksLabel}
              </p>
              <p className="figure text-lead text-ink">GS · LS · SE · LH</p>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {[
                { subject: m.bacArabicSubject, sample: m.bacArabicSample, lang: 'ar', dir: 'rtl' as const },
                { subject: m.bacFrenchSubject, sample: m.bacFrenchSample, lang: 'fr', dir: 'ltr' as const },
                { subject: m.bacEnglishSubject, sample: m.bacEnglishSample, lang: 'en', dir: 'ltr' as const },
              ].map((item) => (
                <Surface key={item.lang} className="p-5">
                  <p className="text-micro font-semibold uppercase tracking-[0.12em] text-ink-faint">
                    {item.subject}
                  </p>
                  {/*
                    `dir` on the text and never on the card. The grid, the
                    padding and the label stay in the reader's direction while
                    the academic line inside reads in its own — which is exactly
                    how the product behaves.
                  */}
                  <p
                    dir={item.dir}
                    lang={item.lang}
                    className={cn(
                      'mt-3 text-meta text-ink',
                      item.dir === 'rtl' ? 'leading-loose' : 'leading-relaxed',
                    )}
                  >
                    {item.sample}
                  </p>
                </Surface>
              ))}
            </div>
          </div>
        </section>

        {/* ================= MOCK ================= */}
        <Story
          title={m.mockTitle}
          titleAccent={m.mockTitleAccent}
          body={m.mockBody}
          reverse
          surface={
            <QuestionFragment
              labels={{
                subject: m.practiceSubject,
                chapter: m.practiceChapter,
                provenance: m.practiceProvenance,
                marks: m.practiceMarks,
              }}
              body={m.practiceQuestion}
              bodyLang="en"
            />
          }
        />

        {/* ================= THE LOOP ================= */}
        <section id="how" className="border-y border-rule">
          <div className="mx-auto w-full max-w-[1180px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <h2 className="max-w-2xl font-display text-heading font-semibold leading-tight tracking-tight text-ink sm:text-display">
              {m.loopTitle}
            </h2>

            {/*
              An ordered list, because it is one. The arrows are decoration and
              hidden from assistive technology; the numbers carry the sequence.
            */}
            <ol className="mt-10 grid gap-px overflow-hidden rounded-lg border border-rule bg-rule md:grid-cols-5">
              {[m.loop1, m.loop2, m.loop3, m.loop4, m.loop5].map((step, i) => (
                <li key={step} className="bg-paper-raised p-5">
                  <span className="figure text-micro text-primary">0{i + 1}</span>
                  <p className="mt-2 text-meta font-medium leading-snug text-ink">{step}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ================= TRY IT ================= */}
        <section className="border-b border-rule">
          <div className="mx-auto w-full max-w-[1180px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <div className="max-w-2xl">
              <h2 className="font-display text-heading font-semibold leading-tight tracking-tight text-ink sm:text-display">
                {m.previewTitle}
              </h2>
              <p className="mt-3 text-body text-ink-muted">{m.previewSubtitle}</p>
            </div>
            <div className="mt-10">
              <PreviewsSlot />
            </div>
            <p className="mt-4 text-caption text-ink-faint">{m.previewNothingSaved}</p>
          </div>
        </section>

        {/* ================= PRICING ================= */}
        <section id="pricing" className="border-b border-rule">
          <div className="mx-auto w-full max-w-[1180px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-xl">
                <h2 className="font-display text-heading font-semibold leading-tight tracking-tight text-ink sm:text-display">
                  {m.pricingTitle}
                </h2>
                <p className="mt-4 text-lead font-medium text-ink">{m.pricingHeading}</p>
                <p className="mt-2 max-w-prose text-body leading-relaxed text-ink-muted">
                  {m.pricingBody}
                </p>
              </div>
              <Link
                href="/signup"
                className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-sm bg-primary px-6 text-body font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {m.pricingCta}
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </section>

        {/* ================= FINAL ================= */}
        <section className="bg-ink text-paper">
          <div className="mx-auto w-full max-w-[1180px] px-4 py-20 text-center sm:px-6 sm:py-28 lg:px-8">
            <h2 className="mx-auto max-w-3xl font-display text-heading font-semibold leading-tight tracking-tight sm:text-display lg:text-hero">
              {m.finalTitle}
              <br />
              <span className="text-correct-bright">{m.finalTitleAccent}</span>
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-body leading-relaxed text-paper/75">
              {m.finalBody}
            </p>
            <div className="mt-9 flex flex-col items-center gap-4">
              <Link
                href="/signup"
                className="inline-flex min-h-12 items-center gap-2 rounded-sm bg-paper px-7 text-body font-semibold text-ink transition-colors hover:bg-paper-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
              >
                {m.finalCta}
                <span aria-hidden>→</span>
              </Link>
              <Link
                href="/login"
                className="rounded-sm text-meta text-paper/70 underline-offset-4 transition-colors hover:text-paper hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-paper"
              >
                {m.finalSignIn}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-4 px-4 py-8 sm:px-6 lg:px-8">
          <p className="text-lead font-semibold tracking-tight text-ink">
            BAC<span className="text-primary">²</span>
          </p>
          <p className="text-caption text-ink-faint">{m.footerNote}</p>
        </div>
      </footer>
    </div>
  );
}

/**
 * One idea, one product surface, alternating sides.
 *
 * The rhythm the page depends on. Every narrative section is this shape, so
 * scrolling has a beat instead of a list of cards, and `reverse` is the only
 * variation — enough to stop the eye settling, far short of a different layout
 * each time.
 */
function Story({
  id,
  title,
  titleAccent,
  body,
  surface,
  reverse = false,
}: {
  id?: string;
  title: string;
  titleAccent?: string;
  body: string;
  surface: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <section id={id} className="border-b border-rule">
      <div className="mx-auto grid w-full max-w-[1180px] items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <div className={cn('max-w-xl', reverse && 'lg:order-2')}>
          <h2 className="font-display text-heading font-semibold leading-tight tracking-tight text-ink sm:text-display">
            {title}
            {titleAccent && (
              <>
                <br />
                <span className="text-primary">{titleAccent}</span>
              </>
            )}
          </h2>
          <p className="mt-5 max-w-prose text-body leading-relaxed text-ink-muted">{body}</p>
        </div>
        <div className={cn('min-w-0', reverse && 'lg:order-1')}>{surface}</div>
      </div>
    </section>
  );
}
