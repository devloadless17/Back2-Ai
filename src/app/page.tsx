import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  GhostNumeral,
  NourMark,
  PaperRuling,
  Seal,
  SectionMark,
} from '@/components/marketing/identity';
import { PreviewsSlot } from '@/components/marketing/previews-slot';
import { SiteHeader } from '@/components/marketing/site-header';
import { ExaminerScript } from '@/components/marketing/examiner-script';
import {
  ExaminerFragment,
  NextMoveFragment,
  NourFragment,
  QuestionPlate,
  ReadinessPlate,
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
 * Two constraints carried over and still true: a signed-in visitor is
 * redirected to their dashboard, and the whole application is `noindex` at the
 * root layout, so this page is shareable but not findable. Making only the
 * marketing page indexable is a product decision that has not been taken.
 *
 * THE IDENTITY IS THE EXAM PAPER. Not a flag, not a cedar, not a mortarboard on
 * every surface — a Baccalaureate script has a ruled margin, a question number
 * in it and the mark allocation printed beside each part, and a candidate has
 * been reading that layout for years. So the page is built out of it: margins
 * carry marks, sections are numbered like parts of a paper, and the one
 * ornament is a struck seal used four times. See `identity.tsx`.
 *
 * Every figure in a product fragment is illustrative and says so where it
 * could be mistaken for a real student's. The corpus numbers in the proof
 * strip are the ones measured in this repository.
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

  const examinerLabels = {
    title: m.examinerLabel,
    nourNote: m.examinerNourNote,
    note: m.examinerNote,
    meta: [m.practiceSubject, m.practiceProvenance, m.examinerExercise],
  };

  const nourLabels = {
    name: m.nourName,
    question: m.nourQuestion,
    answer: m.nourAnswer,
    grounded: m.nourGrounded,
  };

  const nextMoveLabels = {
    eyebrow: m.nextMoveEyebrow,
    subject: m.nextMoveSubject,
    chapter: m.nextMoveChapter,
    reason: m.nextMoveReason,
    cta: m.nextMoveCta,
  };

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
        {/* ======================= HERO ======================= */}
        <section className="relative overflow-hidden border-b border-rule">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(65%_55%_at_78%_-5%,hsl(var(--primary-soft))_0%,transparent_70%)]"
          />
          <PaperRuling />

          <div className="relative mx-auto w-full max-w-[1180px] px-4 pb-16 pt-12 sm:px-6 sm:pb-20 sm:pt-16 lg:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-14">
              <div className="max-w-xl">
                <div className="flex items-center gap-3">
                  <Seal />
                  <p className="text-micro font-semibold uppercase tracking-[0.14em] text-primary">
                    {m.eyebrow}
                  </p>
                </div>

                <h1 className="mt-6 font-display text-[2.35rem] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[3.1rem] lg:text-[3.6rem]">
                  {m.headline}
                  <br />
                  <span className="text-primary">{m.headlineAccent}</span>
                </h1>

                <p className="mt-6 max-w-prose text-lead leading-relaxed text-ink-muted">
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
                ONE HERO OBJECT, TWO SUPPORTING.

                The marked script is the foreground and is allowed to be
                bigger than everything around it, because "it marks you the way
                the exam marks you" is the claim the page rests on. Nour sits
                behind and below it, offset so only its top edge and its
                grounding line show — the way a second sheet shows under the
                first. The next-move card is a small third plane.

                On a phone this becomes one column in reading order and the
                third plane is dropped entirely rather than shrunk into
                something unreadable.
              */}
              <div className="relative">
                <ExaminerFragment
                  labels={examinerLabels}
                  className="relative z-30 lg:max-w-[30rem]"
                />

                <NourFragment
                  labels={nourLabels}
                  className="relative z-20 mt-4 lg:-mt-10 lg:ms-20 lg:max-w-[27rem]"
                />

                <NextMoveFragment
                  labels={nextMoveLabels}
                  className="relative z-30 mt-4 hidden lg:-mt-6 lg:block lg:max-w-[21rem]"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ======================= PROOF ======================= */}
        <section className="border-b border-rule bg-paper-sunken/60">
          <div className="mx-auto w-full max-w-[1180px] px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-9 sm:gap-x-10 lg:grid-cols-4 lg:divide-x lg:divide-rule-strong">
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

        {/* ======================= 01 PRACTICE ======================= */}
        {/*
          The question is the artwork. No card — the metadata heads it the way
          a paper heads an exercise, the margin carries the number and the
          marks, and the question itself is set at reading size with room
          around it.
        */}
        <section id="features" className="relative overflow-hidden border-b border-rule">
          <GhostNumeral className="-top-4 end-2 sm:end-8">01</GhostNumeral>
          <div className="relative mx-auto grid w-full max-w-[1180px] gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16 lg:px-8">
            <div className="max-w-xl">
              <SectionMark index="01" label={m.secPractice} />
              <h2 className="mt-5 font-display text-heading font-semibold leading-tight tracking-tight text-ink sm:text-display">
                {m.practiceTitle}
              </h2>
              <p className="mt-5 max-w-prose text-body leading-relaxed text-ink-muted">
                {m.practiceBody}
              </p>
            </div>
            <QuestionPlate
              labels={{
                number: m.practiceNumber,
                meta: [m.practiceSubject, m.practiceChapter, m.practiceProvenance],
                marks: m.practiceMarks,
              }}
              body={m.practiceQuestion}
              bodyLang="en"
            />
          </div>
        </section>

        {/* ======================= 02 EXAMINER ======================= */}
        {/*
          The product hero of this page.

          Deep warm graphite rather than the section's old brown, so the cream
          script is the brightest thing in the room and the contrast does the
          separating. 40/60 asymmetry: the narrative is the smaller half,
          because the argument here is made by the object, not by the
          paragraph beside it.
        */}
        <section className="relative overflow-hidden border-y border-rule bg-[hsl(28_18%_10%)] text-paper">
          <PaperRuling tone="dark" />
          <div className="relative mx-auto grid w-full max-w-[1180px] items-center gap-14 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[minmax(0,0.68fr)_minmax(0,1fr)] lg:gap-16 lg:px-8">
            <div className="max-w-md">
              <SectionMark index="02" label={m.secExaminer} tone="dark" />
              {/*
                Cream headline with one phrase in mint. The whole line in mint
                shouted and, on this ground, read as a label rather than as a
                sentence.
              */}
              <h2 className="mt-6 font-display text-heading font-semibold leading-[1.12] tracking-tight sm:text-display">
                {m.examinerHeadA}{' '}
                <span className="text-correct-bright">{m.examinerHeadB}</span>
              </h2>
              <p className="mt-6 max-w-prose text-body leading-relaxed text-paper/70">
                {m.examinerLead}
              </p>
              <p className="mt-8 flex items-center gap-3 border-t border-paper/15 pt-5 text-micro uppercase tracking-[0.12em] text-paper/50">
                <Seal
                  tone="paper"
                  className="size-6 [clip-path:polygon(0_0,calc(100%-4px)_0,100%_4px,100%_100%,0_100%)]"
                />
                {m.examinerTrust}
              </p>
            </div>

            <ExaminerScript
              labels={{
                subject: m.scriptSubject,
                session: m.scriptSession,
                exercise: m.scriptExercise,
                total: m.scriptTotal,
                question: m.scriptQuestion,
                answerLabel: m.scriptAnswerLabel,
                line1: m.scriptLine1,
                crit1: m.scriptCrit1,
                mark1: m.scriptMark1,
                line2: m.scriptLine2,
                crit2: m.scriptCrit2,
                mark2: m.scriptMark2,
                missingLabel: m.scriptMissingLabel,
                missing: m.scriptMissing,
                crit3: m.scriptCrit3,
                mark3: m.scriptMark3,
                nourNoteLabel: m.examinerNourNote,
                nourNote: m.scriptNourNote,
              }}
            />
          </div>
        </section>

        {/* ======================= 03 NOUR ======================= */}
        <section className="relative overflow-hidden border-b border-rule bg-primary-soft/40">
          <GhostNumeral className="-top-4 start-2 sm:start-8">03</GhostNumeral>
          <div className="relative mx-auto grid w-full max-w-[1180px] items-center gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16 lg:px-8">
            <NourFragment labels={nourLabels} editorial className="order-2 lg:order-1" />
            <div className="order-1 max-w-xl lg:order-2">
              <SectionMark index="03" label={m.secNour} />
              <NourMark className="mt-5 size-10" />
              <h2 className="mt-5 font-display text-heading font-semibold leading-tight tracking-tight text-ink sm:text-display">
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

        {/* ======================= 04 STANDING ======================= */}
        {/*
          An academic report, not a dashboard. The mark anchors it; Mastery,
          Practised and Evidence read as a row of figures under a rule; where
          marks go reads as examiner feedback. No boxes.
        */}
        <section className="relative overflow-hidden border-b border-rule">
          <GhostNumeral className="-top-4 end-2 sm:end-8">04</GhostNumeral>
          <div className="relative mx-auto grid w-full max-w-[1180px] gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-16 lg:px-8">
            <div className="max-w-xl">
              <SectionMark index="04" label={m.secProgress} />
              <h2 className="mt-5 font-display text-heading font-semibold leading-tight tracking-tight text-ink sm:text-display">
                {m.progressTitle}
                <br />
                <span className="text-primary">{m.progressTitleAccent}</span>
              </h2>
              <p className="mt-5 max-w-prose text-body leading-relaxed text-ink-muted">
                {m.progressBody}
              </p>
            </div>
            <ReadinessPlate
              labels={{
                eyebrow: m.readinessEyebrow,
                readiness: m.readinessCaption,
                mastery: m.masteryLabel,
                practised: m.practisedLabel,
                evidence: m.evidenceLabel,
                evidenceValue: m.evidenceValue,
                illustrative: m.illustrative,
                marksLostEyebrow: m.marksLostEyebrow,
                rows: [
                  { criterion: m.marksLost1, count: m.marksLost1Count },
                  { criterion: m.marksLost2, count: m.marksLost2Count },
                  { criterion: m.marksLost3, count: m.marksLost3Count },
                ],
              }}
            />
          </div>
        </section>

        {/* ======================= 05 NEXT MOVE ======================= */}
        <section className="border-b border-rule bg-paper-sunken/60">
          <div className="mx-auto grid w-full max-w-[1180px] items-center gap-10 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:gap-16 lg:px-8">
            <div className="max-w-xl">
              <SectionMark index="05" label={m.secNextMove} />
              <h2 className="mt-5 font-display text-title font-semibold leading-tight tracking-tight text-ink sm:text-heading">
                {m.nextMoveTitle}{' '}
                <span className="text-primary">{m.nextMoveTitleAccent}</span>
              </h2>
              <p className="mt-4 max-w-prose text-body leading-relaxed text-ink-muted">
                {m.nextMoveBody}
              </p>
            </div>
            <NextMoveFragment labels={nextMoveLabels} />
          </div>
        </section>

        {/* ======================= 06 YOUR BAC ======================= */}
        {/*
          The section that earns the word "Lebanese". No flag — the four tracks
          set large, the three languages of instruction, and three real
          academic lines each sitting in its own direction inside a grid that
          does not move. That last part IS the argument.
        */}
        <section id="bac" className="relative overflow-hidden border-b border-rule bg-ink text-paper">
          <PaperRuling tone="dark" />
          <div className="relative mx-auto w-full max-w-[1180px] px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
            <div className="max-w-2xl">
              <SectionMark index="06" label={m.secBac} tone="dark" />
              <h2 className="mt-5 font-display text-heading font-semibold leading-tight tracking-tight sm:text-display">
                {m.bacTitle}
                <br />
                <span className="text-correct-bright">{m.bacTitleAccent}</span>
              </h2>
              <p className="mt-5 max-w-prose text-body leading-relaxed text-paper/70">{m.bacBody}</p>
            </div>

            {/* The tracks, large and confident. This is the line a Lebanese
                candidate recognises instantly and nobody else does. */}
            <div className="mt-12 border-y border-paper/15 py-8">
              <p className="text-micro font-semibold uppercase tracking-[0.14em] text-paper/50">
                {m.tracksLabel}
              </p>
              <p className="figure mt-4 text-[2rem] leading-none text-paper sm:text-[3rem]">
                GS<span className="px-3 text-paper/30">·</span>LS
                <span className="px-3 text-paper/30">·</span>SE
                <span className="px-3 text-paper/30">·</span>LH
              </p>
            </div>

            <p className="mt-10 text-micro font-semibold uppercase tracking-[0.14em] text-paper/50">
              {m.languagesLabel}
            </p>
            <div className="mt-5 grid gap-px overflow-hidden rounded-lg bg-paper/15 md:grid-cols-3">
              {[
                { subject: m.bacArabicSubject, sample: m.bacArabicSample, lang: 'ar', dir: 'rtl' as const, name: 'العربية' },
                { subject: m.bacFrenchSubject, sample: m.bacFrenchSample, lang: 'fr', dir: 'ltr' as const, name: 'Français' },
                { subject: m.bacEnglishSubject, sample: m.bacEnglishSample, lang: 'en', dir: 'ltr' as const, name: 'English' },
              ].map((item) => (
                <div key={item.lang} className="bg-ink p-6">
                  <p
                    dir={item.dir}
                    lang={item.lang}
                    className="font-display text-title font-semibold text-paper"
                  >
                    {item.name}
                  </p>
                  <p className="mt-1 text-micro uppercase tracking-[0.1em] text-paper/45">
                    {item.subject}
                  </p>
                  {/*
                    `dir` on the text and never on the card. The grid, the
                    padding and the label stay in the reader's direction while
                    the academic line inside reads in its own.
                  */}
                  <p
                    dir={item.dir}
                    lang={item.lang}
                    className={cn(
                      'mt-5 border-t border-paper/15 pt-5 text-meta text-paper/80',
                      item.dir === 'rtl' ? 'leading-loose' : 'leading-relaxed',
                    )}
                  >
                    {item.sample}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ======================= 07 MOCK ======================= */}
        <section className="relative overflow-hidden border-b border-rule">
          <GhostNumeral className="-top-4 start-2 sm:start-8">07</GhostNumeral>
          <div className="relative mx-auto grid w-full max-w-[1180px] gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16 lg:px-8">
            <QuestionPlate
              labels={{
                number: '01',
                meta: [m.practiceSubject, m.practiceProvenance, m.examinerExercise],
                marks: m.practiceMarks,
              }}
              body={m.practiceQuestion}
              bodyLang="en"
              className="order-2 lg:order-1"
            />
            <div className="order-1 max-w-xl lg:order-2">
              <SectionMark index="07" label={m.secMock} />
              <h2 className="mt-5 font-display text-heading font-semibold leading-tight tracking-tight text-ink sm:text-display">
                {m.mockTitle}
                <br />
                <span className="text-primary">{m.mockTitleAccent}</span>
              </h2>
              <p className="mt-5 max-w-prose text-body leading-relaxed text-ink-muted">
                {m.mockBody}
              </p>
            </div>
          </div>
        </section>

        {/* ======================= THE LOOP ======================= */}
        {/*
          Compact and horizontal — the page should be accelerating by now, not
          presenting another full-height section.
        */}
        <section id="how" className="border-b border-rule bg-paper-sunken/60">
          <div className="mx-auto w-full max-w-[1180px] px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
            <h2 className="font-display text-title font-semibold tracking-tight text-ink sm:text-heading">
              {m.loopTitle}
            </h2>
            <ol className="mt-7 grid gap-x-6 gap-y-5 sm:grid-cols-5">
              {[m.loop1, m.loop2, m.loop3, m.loop4, m.loop5].map((step, i) => (
                <li key={step} className="border-t border-rule-strong pt-3">
                  <span className="figure text-micro text-primary">0{i + 1}</span>
                  <p className="mt-1.5 text-meta font-medium leading-snug text-ink">{step}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ======================= TRY IT ======================= */}
        <section className="border-b border-rule">
          <div className="mx-auto w-full max-w-[1180px] px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-xl">
                <h2 className="font-display text-title font-semibold tracking-tight text-ink sm:text-heading">
                  {m.previewTitle}
                </h2>
                <p className="mt-2 text-body text-ink-muted">{m.previewSubtitle}</p>
              </div>
              <p className="text-caption text-ink-faint">{m.previewNothingSaved}</p>
            </div>
            <div className="mt-8">
              <PreviewsSlot />
            </div>
          </div>
        </section>

        {/* ======================= PRICING ======================= */}
        <section id="pricing" className="border-b border-rule">
          <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-4 py-12 sm:px-6 sm:py-14 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div className="max-w-xl">
              <p className="text-micro font-semibold uppercase tracking-[0.14em] text-primary">
                {m.pricingTitle}
              </p>
              <p className="mt-3 font-display text-title font-semibold text-ink">
                {m.pricingHeading}
              </p>
              <p className="mt-2 max-w-prose text-meta leading-relaxed text-ink-muted">
                {m.pricingBody}
              </p>
            </div>
            <Link
              href="/signup"
              className="inline-flex min-h-12 shrink-0 items-center gap-2 self-start rounded-sm bg-primary px-6 text-body font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:self-auto"
            >
              {m.pricingCta}
              <span aria-hidden>→</span>
            </Link>
          </div>
        </section>

        {/* ======================= CLOSE ======================= */}
        {/*
          The cover closing on an academic publication. The seal returns, the
          ruling returns, the type is the largest on the page, and there is one
          action.
        */}
        <section className="relative overflow-hidden bg-ink text-paper">
          <PaperRuling tone="dark" />
          <div className="relative mx-auto w-full max-w-[1180px] px-4 py-24 text-center sm:px-6 sm:py-32 lg:px-8">
            <Seal tone="paper" className="mx-auto size-11" />
            <h2 className="mx-auto mt-10 max-w-3xl font-display text-heading font-semibold leading-[1.12] tracking-tight sm:text-display lg:text-hero">
              {m.finalTitle}
              <br />
              <span className="text-correct-bright">{m.finalTitleAccent}</span>
            </h2>
            <p className="mx-auto mt-7 max-w-xl text-body leading-relaxed text-paper/70">
              {m.finalBody}
            </p>
            <div className="mt-10 flex flex-col items-center gap-5">
              <Link
                href="/signup"
                className="inline-flex min-h-12 items-center gap-2 rounded-sm bg-paper px-8 text-body font-semibold text-ink transition-colors hover:bg-paper-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
              >
                {m.finalCta}
                <span aria-hidden>→</span>
              </Link>
              <Link
                href="/login"
                className="rounded-sm text-meta text-paper/60 underline-offset-4 transition-colors hover:text-paper hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-paper"
              >
                {m.finalSignIn}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-4 px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Seal className="size-7 [clip-path:polygon(0_0,calc(100%-5px)_0,100%_5px,100%_100%,0_100%)]" />
            <p className="text-lead font-semibold tracking-tight text-ink">
              BAC<span className="text-primary">²</span>
            </p>
          </div>
          <p className="text-caption text-ink-faint">{m.footerNote}</p>
        </div>
      </footer>
    </div>
  );
}
