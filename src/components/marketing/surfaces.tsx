import { cn } from '@/lib/cn';

/**
 * Product fragments, for the public page.
 *
 * The visual asset on this page is BAC2 itself. Not an illustration of a
 * student at a laptop, not an abstract graphic standing in for "learning" —
 * the actual surfaces, cropped the way a magazine crops a photograph.
 *
 * DELIBERATELY NOT THE REAL COMPONENTS. `ExaminerMark`, `AcademicQuestion` and
 * the evidence panel all expect marked attempts, a barème and a retrieval
 * result, and importing them here would couple the front door to the student
 * data model and drag KaTeX and react-markdown onto the one page opened by
 * someone who has not signed up yet, usually on a phone, usually on Lebanese
 * mobile data. These are faithful copies in markup only: same tokens, same
 * type scale, same semantic colours, same glyph vocabulary.
 *
 * The academic content inside them is deliberately left in its own language.
 * An Arabic history question is shown in Arabic and a French mathematics one
 * in French, because that mix is the product's subject matter and pretending
 * otherwise would be showing a different product.
 *
 * Everything here is illustrative. No number on this page is presented as a
 * real student's result.
 */

/* -------------------------------------------------------------------------
 * The frame every fragment sits in.
 * ---------------------------------------------------------------------- */

/**
 * Depth from overlap and a hairline, never from glow.
 *
 * One border, one very small shadow, and the surface sits forward because it
 * overlaps something behind it — which is how a real object reads. The large
 * soft shadows in the authenticated UI are not carried over here; at marketing
 * scale they turn into haze.
 */
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

/** The small-caps marker the whole product uses for a field name. */
function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('text-micro font-semibold uppercase tracking-[0.12em]', className)}>
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------
 * Examiner Mode — the signature fragment.
 * ---------------------------------------------------------------------- */

type Criterion = {
  outcome: 'earned' | 'partial' | 'lost';
  label: string;
  awarded: string;
};

const GLYPH: Record<Criterion['outcome'], string> = {
  earned: '✓',
  partial: '◐',
  lost: '×',
};

/**
 * Colour carries meaning here and nowhere else on the page.
 *
 * Teal is a mark earned, amber a mark part-earned, rose a mark lost. Rose has
 * impact precisely because it appears once on the whole site. The glyph is
 * always present, so the state survives without colour.
 */
const OUTCOME_CLASS: Record<Criterion['outcome'], string> = {
  earned: 'text-correct',
  partial: 'text-partial',
  lost: 'text-mark',
};

export function ExaminerFragment({
  labels,
  className,
}: {
  labels: { title: string; nourNote: string; note: string };
  className?: string;
}) {
  const criteria: Criterion[] = [
    { outcome: 'earned', label: 'Correct method', awarded: '4/4' },
    { outcome: 'partial', label: 'Explanation incomplete', awarded: '2/3' },
    { outcome: 'lost', label: 'Missing justification', awarded: '0/2' },
  ];

  return (
    <Surface className={cn('overflow-hidden', className)}>
      <div className="flex items-baseline justify-between gap-4 border-b border-rule px-5 py-3">
        <Eyebrow className="text-ink-faint">{labels.title}</Eyebrow>
        {/* The mark is the thing. It gets the largest type in the fragment and
            the tabular, tightened treatment every figure in the product uses. */}
        <p className="figure text-display leading-none">
          14<span className="text-title font-normal text-ink-faint"> / 20</span>
        </p>
      </div>

      <ul className="divide-y divide-rule">
        {criteria.map((item) => (
          <li key={item.label} className="flex items-center gap-3 px-5 py-2.5">
            <span aria-hidden className={cn('w-4 text-center text-body', OUTCOME_CLASS[item.outcome])}>
              {GLYPH[item.outcome]}
            </span>
            <span className="min-w-0 flex-1 truncate text-meta text-ink">{item.label}</span>
            <span className={cn('figure text-meta', OUTCOME_CLASS[item.outcome])}>
              {item.awarded}
            </span>
          </li>
        ))}
      </ul>

      <div className="border-t border-rule bg-primary-soft/50 px-5 py-3.5">
        <Eyebrow className="text-primary">{labels.nourNote}</Eyebrow>
        <p className="mt-1 text-meta leading-relaxed text-ink">{labels.note}</p>
      </div>
    </Surface>
  );
}

/* -------------------------------------------------------------------------
 * Nour — an answer with its sources under it.
 * ---------------------------------------------------------------------- */

/**
 * The mortarboard, small.
 *
 * Nour has a face in the product and it stays this size everywhere. A tutor
 * who is beside the student does not need to be the largest thing on screen,
 * and scaling this up is how an identity becomes a mascot.
 */
export function NourMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
        <path d="M12 3 1.5 8.25 12 13.5l8.25-4.125V15h1.5V8.25L12 3Z" />
        <path d="M5.25 11.1v3.9c0 1.7 3.02 3.15 6.75 3.15s6.75-1.45 6.75-3.15v-3.9L12 14.85 5.25 11.1Z" />
      </svg>
    </span>
  );
}

export function NourFragment({
  labels,
  className,
}: {
  labels: { name: string; question: string; answer: string; grounded: string };
  className?: string;
}) {
  return (
    <Surface className={cn('overflow-hidden', className)}>
      {/* The student's own line stays compact — it is the shorter half of the
          exchange and giving it equal weight makes the page read as chat. */}
      <div className="border-b border-rule bg-paper-sunken px-5 py-3">
        <p className="text-meta text-ink-muted" lang="fr">
          {labels.question}
        </p>
      </div>

      <div className="px-5 py-4">
        <div className="flex items-center gap-2.5">
          <NourMark />
          <Eyebrow className="text-primary">{labels.name}</Eyebrow>
        </div>
        {/* Nour's answer gets the reading measure and the leading. This is the
            academic content, so it is the part allowed to breathe. */}
        <p className="mt-2.5 max-w-prose text-body leading-relaxed text-ink">{labels.answer}</p>
      </div>

      {/*
        Evidence, quiet. A student should register that the answer is grounded
        without meeting a citation system — so it is one line of provenance and
        two sources, set small, under a hairline.
      */}
      <div className="border-t border-rule px-5 py-3">
        <Eyebrow className="text-ink-faint">{labels.grounded}</Eyebrow>
        <dl className="mt-2 space-y-1.5">
          <div className="flex items-baseline gap-2 text-caption">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
            <dt className="font-medium text-ink">2022 · Second Session</dt>
            <dd className="text-ink-faint">Official solution</dd>
          </div>
          <div className="flex items-baseline gap-2 text-caption">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full border border-rule-strong" />
            <dt className="font-medium text-ink">Physics · Mechanics</dt>
            <dd className="text-ink-faint">Textbook</dd>
          </div>
        </dl>
      </div>
    </Surface>
  );
}

/* -------------------------------------------------------------------------
 * Next move — the product turning evidence into one instruction.
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
      {/* The same 3px mint edge the product uses to mark its primary action.
          `start` rather than `left`, so it sits correctly in Arabic. */}
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
 * A real question, as the exam prints it.
 * ---------------------------------------------------------------------- */

export function QuestionFragment({
  labels,
  body,
  bodyLang,
  bodyDir = 'ltr',
  className,
}: {
  labels: { subject: string; chapter: string; provenance: string; marks: string };
  body: string;
  bodyLang: string;
  bodyDir?: 'ltr' | 'rtl';
  className?: string;
}) {
  return (
    <Surface className={cn('overflow-hidden', className)}>
      {/* The masthead a real paper carries: subject, chapter, which paper it
          came off, what it is worth. Set small, so the question dominates. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule px-5 py-3">
        <div className="min-w-0">
          <Eyebrow className="text-ink-faint">{labels.subject}</Eyebrow>
          <p className="mt-0.5 text-meta font-medium text-ink">{labels.chapter}</p>
        </div>
        <p className="shrink-0 text-caption text-ink-faint">
          {labels.provenance} · <span className="figure text-caption">{labels.marks}</span>
        </p>
      </div>

      {/*
        The question is the interface. Reading measure, generous leading, and
        its own direction — `dir` sits on the text and never on the layout
        around it, which is what lets an Arabic paper live inside an English
        page without the page flipping.
      */}
      <div className="px-5 py-5">
        <p
          dir={bodyDir}
          lang={bodyLang}
          className={cn(
            'max-w-prose text-body text-ink',
            bodyDir === 'rtl' ? 'leading-loose' : 'leading-relaxed',
          )}
        >
          {body}
        </p>
      </div>
    </Surface>
  );
}

/* -------------------------------------------------------------------------
 * Readiness — editorial, not a gauge.
 * ---------------------------------------------------------------------- */

export function ReadinessFragment({
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
  };
  className?: string;
}) {
  const rows = [
    { label: labels.mastery, value: '72%', bar: 0.72 },
    { label: labels.practised, value: '48%', bar: 0.48 },
  ];

  return (
    <Surface className={cn('overflow-hidden', className)}>
      <div className="border-b border-rule px-5 py-4">
        <Eyebrow className="text-ink-faint">{labels.eyebrow}</Eyebrow>
        <p className="mt-2 figure text-display leading-none">
          12.8<span className="text-title font-normal text-ink-faint"> / 20</span>
        </p>
        <p className="mt-1.5 text-caption text-ink-faint">{labels.readiness}</p>
      </div>

      <dl className="space-y-3 px-5 py-4">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-meta text-ink-muted">{row.label}</dt>
              <dd className="figure text-meta">{row.value}</dd>
            </div>
            {/* A thin rule, not a chart. Length is the only variable. */}
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-sm bg-paper-sunken">
              <div className="h-full bg-primary" style={{ width: `${row.bar * 100}%` }} />
            </div>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 border-t border-rule pt-3">
          <dt className="text-meta text-ink-muted">{labels.evidence}</dt>
          <dd className="figure text-meta">{labels.evidenceValue}</dd>
        </div>
      </dl>

      {/* Said plainly. These are sample figures on a public page, not anyone's
          marks, and the product's whole argument is that it does not invent
          numbers — so it cannot start here. */}
      <p className="border-t border-rule px-5 py-2.5 text-micro text-ink-faint">
        {labels.illustrative}
      </p>
    </Surface>
  );
}

/* -------------------------------------------------------------------------
 * Where marks go — the recurring-loss view.
 * ---------------------------------------------------------------------- */

export function MarksLostFragment({
  labels,
  className,
}: {
  labels: { eyebrow: string; rows: { criterion: string; count: string }[]; illustrative: string };
  className?: string;
}) {
  return (
    <Surface className={cn('overflow-hidden', className)}>
      <div className="border-b border-rule px-5 py-3">
        <Eyebrow className="text-ink-faint">{labels.eyebrow}</Eyebrow>
      </div>
      <ul className="divide-y divide-rule">
        {labels.rows.map((row) => (
          <li key={row.criterion} className="flex items-baseline justify-between gap-4 px-5 py-3">
            <span className="min-w-0 text-meta text-ink">{row.criterion}</span>
            {/* Rose, because these are marks actually lost. It is the second
                and last place on the page this colour appears. */}
            <span className="figure shrink-0 text-meta text-mark">{row.count}</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-rule px-5 py-2.5 text-micro text-ink-faint">
        {labels.illustrative}
      </p>
    </Surface>
  );
}
