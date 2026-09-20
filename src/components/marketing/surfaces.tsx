import { MarginRule, NourMark, Seal } from '@/components/marketing/identity';
import { cn } from '@/lib/cn';

export { NourMark } from '@/components/marketing/identity';

/**
 * Product fragments, for the public page.
 *
 * The visual asset on this page is BAC2 itself. Not an illustration of a
 * student at a laptop — the actual surfaces, cropped the way a magazine crops
 * a photograph, and dressed in the language of the thing they are about: a
 * marked examination script.
 *
 * DELIBERATELY NOT THE REAL COMPONENTS. `ExaminerMark`, `AcademicQuestion` and
 * the evidence panel all expect marked attempts, a barème and a retrieval
 * result, and importing them here would couple the front door to the student
 * data model and drag KaTeX and react-markdown onto the one page opened by
 * someone who has not signed up yet, usually on a phone, usually on Lebanese
 * mobile data. These are faithful copies in markup only: same tokens, same
 * type scale, same semantic colours, same glyph vocabulary.
 *
 * The academic content inside them is left in its own language. An Arabic
 * history question is shown in Arabic and a French mathematics one in French,
 * because that mix is the product's subject matter.
 *
 * Everything here is illustrative. No number is presented as a real student's.
 */

/* -------------------------------------------------------------------------
 * Frames.
 * ---------------------------------------------------------------------- */

export function Surface({
  children,
  className,
  tone = 'raised',
}: {
  children: React.ReactNode;
  className?: string;
  tone?: 'raised' | 'sunken';
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-rule',
        tone === 'raised' ? 'bg-paper-raised shadow-sm' : 'bg-paper-sunken',
        className,
      )}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('text-micro font-semibold uppercase tracking-[0.12em]', className)}>
      {children}
    </p>
  );
}

/**
 * The masthead a real paper carries.
 *
 * Subject, the paper it came off, the exercise. Set in one thin line above the
 * content, the way a printed script identifies itself — this is the detail
 * that makes a fragment read as an exam rather than as an app screen.
 */
function PaperMeta({
  items,
  tone = 'light',
  className,
}: {
  items: string[];
  tone?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <p
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 text-micro uppercase tracking-[0.1em]',
        tone === 'dark' ? 'text-paper/50' : 'text-ink-faint',
        className,
      )}
    >
      {items.map((item, i) => (
        <span key={item} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden>·</span>}
          {item}
        </span>
      ))}
    </p>
  );
}

/* -------------------------------------------------------------------------
 * Examiner.
 * ---------------------------------------------------------------------- */

type Criterion = { outcome: 'earned' | 'partial' | 'lost'; label: string; awarded: string; of: string };

const GLYPH: Record<Criterion['outcome'], string> = { earned: '✓', partial: '◐', lost: '×' };

/** Colour carries meaning here and almost nowhere else on the page. */
const OUTCOME: Record<Criterion['outcome'], string> = {
  earned: 'text-correct',
  partial: 'text-partial',
  lost: 'text-mark',
};

const CRITERIA: Criterion[] = [
  { outcome: 'earned', label: 'Correct method', awarded: '4', of: '4' },
  { outcome: 'partial', label: 'Explanation incomplete', awarded: '2', of: '3' },
  { outcome: 'lost', label: 'Missing justification', awarded: '0', of: '2' },
];

export type ExaminerLabels = {
  title: string;
  nourNote: string;
  note: string;
  meta: string[];
};

/**
 * The marked script, compact — for the hero, where it is the foreground object.
 */
export function ExaminerFragment({
  labels,
  className,
}: {
  labels: ExaminerLabels;
  className?: string;
}) {
  return (
    <Surface className={cn('overflow-hidden', className)}>
      <div className="border-b border-rule px-5 pb-3 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Eyebrow className="text-ink-faint">{labels.title}</Eyebrow>
            <PaperMeta items={labels.meta} className="mt-2" />
          </div>
          {/* The mark. Largest thing in the fragment, tabular and tightened,
              because "it marks you" is the claim the whole page rests on. */}
          <p className="figure shrink-0 text-display leading-none">
            14<span className="text-title font-normal text-ink-faint">/20</span>
          </p>
        </div>
      </div>

      {/* Each criterion sits against the margin, with what it was worth in it. */}
      <ul className="divide-y divide-rule">
        {CRITERIA.map((item) => (
          <li key={item.label}>
            <MarginRule marks={item.of} className="px-5 py-2.5">
              <div className="flex items-center gap-2.5">
                <span aria-hidden className={cn('text-body leading-none', OUTCOME[item.outcome])}>
                  {GLYPH[item.outcome]}
                </span>
                <span className="min-w-0 flex-1 truncate text-meta text-ink">{item.label}</span>
                <span className={cn('figure text-meta', OUTCOME[item.outcome])}>{item.awarded}</span>
              </div>
            </MarginRule>
          </li>
        ))}
      </ul>

      {/*
        Nour's note as a margin annotation, not another panel. A teacher writes
        in the margin beside the line that cost you the mark; the rule and the
        indent are doing the same job here.
      */}
      <div className="border-t border-rule bg-primary-soft/40 px-5 py-3.5">
        <div className="flex gap-3 border-s-2 border-primary ps-3">
          <div className="min-w-0">
            <Eyebrow className="text-primary">{labels.nourNote}</Eyebrow>
            <p className="mt-1 text-meta leading-relaxed text-ink">{labels.note}</p>
          </div>
        </div>
      </div>
    </Surface>
  );
}

/* -------------------------------------------------------------------------
 * Nour.
 * ---------------------------------------------------------------------- */

export function NourFragment({
  labels,
  className,
  editorial = false,
}: {
  labels: { name: string; question: string; answer: string; grounded: string };
  className?: string;
  /** Larger, for the section where Nour is the subject rather than a support. */
  editorial?: boolean;
}) {
  return (
    <Surface className={cn('overflow-hidden', className)}>
      {/* The student's own line stays compact — it is the shorter half of the
          exchange, and equal weight would make the page read as chat. */}
      <div className="border-b border-rule bg-paper-sunken px-5 py-3">
        <p className="text-meta text-ink-muted" lang="fr">
          {labels.question}
        </p>
      </div>

      <div className={cn('px-5', editorial ? 'py-6' : 'py-4')}>
        <div className="flex gap-3.5">
          <NourMark className={cn('mt-0.5', editorial && 'size-8')} />
          <div className="min-w-0">
            <Eyebrow className="text-primary">{labels.name}</Eyebrow>
            <p
              className={cn(
                'mt-2 max-w-prose leading-relaxed text-ink',
                editorial ? 'text-lead' : 'text-body',
              )}
            >
              {labels.answer}
            </p>
          </div>
        </div>
      </div>

      {/*
        The trust signature. Sealed rather than chipped: the seal, the phrase,
        then the sources as a thin trail. A student should register that the
        answer is grounded without meeting a citation system.
      */}
      <div className="border-t border-rule px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <Seal className="size-6 [clip-path:polygon(0_0,calc(100%-5px)_0,100%_5px,100%_100%,0_100%)]" tone="primary" />
          <Eyebrow className="text-primary">{labels.grounded}</Eyebrow>
        </div>
        <dl className="mt-3 space-y-1.5 border-s border-rule-strong ps-3">
          <div className="flex flex-wrap items-baseline gap-x-2 text-caption">
            <dt className="font-medium text-ink">2022 · Second Session</dt>
            <dd className="text-ink-faint">Official solution</dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2 text-caption">
            <dt className="font-medium text-ink">Physics · Mechanics</dt>
            <dd className="text-ink-faint">Textbook</dd>
          </div>
        </dl>
      </div>
    </Surface>
  );
}

/* -------------------------------------------------------------------------
 * Next move.
 * ---------------------------------------------------------------------- */

export function NextMoveFragment({
  labels,
  className,
}: {
  labels: { eyebrow: string; subject: string; chapter: string; reason: string; cta: string };
  className?: string;
}) {
  return (
    <Surface className={cn('relative overflow-hidden', className)}>
      <span aria-hidden className="absolute inset-y-0 start-0 w-[3px] bg-primary" />
      <div className="p-5 ps-6">
        <Eyebrow className="text-primary">{labels.eyebrow}</Eyebrow>
        <p className="mt-2 text-caption text-ink-faint">{labels.subject}</p>
        <p className="text-lead font-semibold leading-snug text-ink">{labels.chapter}</p>
        <p className="mt-2 max-w-prose text-meta leading-relaxed text-ink-muted">{labels.reason}</p>
        <p className="mt-3 text-meta font-semibold text-primary">
          {labels.cta} <span aria-hidden>→</span>
        </p>
      </div>
    </Surface>
  );
}

/* -------------------------------------------------------------------------
 * A question, as the paper prints it.
 * ---------------------------------------------------------------------- */

/**
 * The question is the artwork.
 *
 * No surface, no border, no card — the metadata sits above it the way a paper
 * heads an exercise, the margin carries the number and the marks, and the
 * question itself is set at reading size with room around it. Interface chrome
 * would only get in the way of the one thing this section is about.
 */
export function QuestionPlate({
  labels,
  body,
  bodyLang,
  bodyDir = 'ltr',
  className,
}: {
  labels: { number: string; meta: string[]; marks: string };
  body: string;
  bodyLang: string;
  bodyDir?: 'ltr' | 'rtl';
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <PaperMeta items={labels.meta} />
      <div className="mt-5 border-t border-rule-strong pt-6">
        <MarginRule number={labels.number} marks={labels.marks}>
          {/*
            `dir` on the text and never on the layout around it. The margin,
            the metadata and the grid stay in the reader's direction while an
            Arabic paper inside them reads right to left — which is exactly how
            the product behaves.
          */}
          <p
            dir={bodyDir}
            lang={bodyLang}
            className={cn(
              'max-w-prose text-lead text-ink',
              bodyDir === 'rtl' ? 'leading-loose' : 'leading-relaxed',
            )}
          >
            {body}
          </p>
        </MarginRule>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Readiness — an academic report, not a dashboard.
 * ---------------------------------------------------------------------- */

export function ReadinessPlate({
  labels,
  className,
}: {
  labels: {
    eyebrow: string;
    readiness: string;
    mastery: string;
    practised: string;
    evidence: string;
    evidenceValue: string;
    illustrative: string;
    marksLostEyebrow: string;
    rows: { criterion: string; count: string }[];
  };
  className?: string;
}) {
  const figures = [
    { label: labels.mastery, value: '72%' },
    { label: labels.practised, value: '48%' },
    { label: labels.evidence, value: labels.evidenceValue },
  ];

  return (
    <div className={cn('min-w-0', className)}>
      <Eyebrow className="text-ink-faint">{labels.eyebrow}</Eyebrow>

      {/* The anchor. Everything under it is support. */}
      <p className="figure mt-4 text-[3.25rem] leading-none sm:text-[4rem]">
        12.8<span className="text-heading font-normal text-ink-faint">/20</span>
      </p>
      <p className="mt-2 text-meta text-ink-muted">{labels.readiness}</p>

      {/* Rules and type, no boxes. A report states three figures in a row and
          trusts the reader to read a row. */}
      <dl className="mt-8 grid grid-cols-3 gap-x-4 border-y border-rule py-5">
        {figures.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-micro uppercase tracking-[0.1em] text-ink-faint">{f.label}</dt>
            <dd className="figure mt-1.5 text-title">{f.value}</dd>
          </div>
        ))}
      </dl>

      {/* Examiner feedback, in the same voice as the marked script above. */}
      <div className="mt-8">
        <Eyebrow className="text-ink-faint">{labels.marksLostEyebrow}</Eyebrow>
        <ul className="mt-3 divide-y divide-rule border-t border-rule">
          {labels.rows.map((row) => (
            <li key={row.criterion} className="flex items-baseline justify-between gap-4 py-3">
              <span className="min-w-0 text-body text-ink">{row.criterion}</span>
              {/* Rose, because these are marks actually lost. */}
              <span className="figure shrink-0 text-meta text-mark">{row.count}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-4 text-micro text-ink-faint">{labels.illustrative}</p>
    </div>
  );
}
