import { QuestionBody } from '@/components/ui/math';
import { cn } from '@/lib/cn';

/**
 * A Bac question, presented as examination material.
 *
 * THE CANONICAL PRESENTATION, not a card built for one page. The same question
 * appears in practice, in a mock paper, in past papers, in a worksheet, and
 * beside an answer in history — and every one of those had been free to draw it
 * differently. This is the primitive they should all reach for.
 *
 * ITS RESPONSIBILITY IS THE QUESTION AND ITS PROVENANCE. Not the answer box,
 * not submit, not navigation. A component that owned those could not be reused
 * in a worksheet, where there is no workspace, or in past papers, where there
 * is no submission.
 *
 * AUTHENTICITY WITHOUT A BADGE. There is no green OFFICIAL stamp. What makes
 * this read as examination material is the metadata line — subject, year,
 * session, marks — set in small caps above a generous measure, the way the
 * paper itself sets it. A stamp would be the product talking about the
 * material; a masthead is the material.
 *
 * ONLY METADATA WE HAVE. Year and session come from `exam_cycles`; marks are
 * summed from the barème's own criteria. Paper number, question number on the
 * paper, and examiner region are NOT in this schema and must stay absent rather
 * than become invented UI — the same rule the evidence work in Nour follows.
 *
 * A question with no exam cycle behind it is textbook material and says
 * nothing about being official, because it is not.
 */

export type AcademicQuestionMeta = {
  subjectName?: string | null;
  chapterName?: string | null;
  examYear?: number | null;
  examSession?: string | null;
  /** Total marks, summed from the barème. Null when the question carries none. */
  marks?: number | null;
};

export function AcademicQuestion({
  contentText,
  contentLatex,
  images,
  meta,
  labels,
  className,
}: {
  contentText: string;
  contentLatex?: string | null;
  images?: string[] | null;
  meta?: AcademicQuestionMeta;
  labels: {
    /** Small-caps masthead, shown only for a question from a real paper. */
    officialBac: string;
    /** "Session {n}" */
    session: string;
    /** "{count} marks" */
    marks: string;
    question: string;
  };
  className?: string;
}) {
  const official = Boolean(meta?.examYear);

  /*
   * Facts only, each omitted when absent rather than printed as a placeholder.
   * A line reading "2019 · Session 1 · 4 marks" is provenance; one reading
   * "— · — · —" is an apology for the corpus.
   */
  const facts = [
    meta?.examYear ? String(meta.examYear) : null,
    meta?.examSession ? labels.session.replace('{n}', meta.examSession.endsWith('2') ? '2' : '1') : null,
  ].filter(Boolean);

  return (
    <article className={cn('', className)}>
      <header className="border-b border-rule pb-3">
        {official && (
          <p className="text-micro font-semibold uppercase tracking-[0.14em] text-primary">
            {labels.officialBac}
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            {meta?.subjectName && (
              <p className="break-words text-sm font-semibold text-ink">{meta.subjectName}</p>
            )}
            {facts.length > 0 && (
              <p className="text-caption tabular-nums text-ink-faint">{facts.join(' · ')}</p>
            )}
            {!official && meta?.chapterName && (
              <p className="break-words text-caption text-ink-faint">{meta.chapterName}</p>
            )}
          </div>

          {/*
            MARKS ARE NOT TRIVIA. A Bac candidate reads "4 marks" and decides how
            long to spend and how much to write — it changes the behaviour, so it
            gets its own weight on the right of the masthead. Tabular so the
            figure sits still between questions, and never louder than the
            question itself.
          */}
          {meta?.marks ? (
            <p className="shrink-0 text-caption font-semibold tabular-nums text-ink-muted">
              {labels.marks.replace('{count}', formatMarks(meta.marks))}
            </p>
          ) : null}
        </div>
      </header>

      {/*
        `prose-exam` holds the reading measure at 68ch, which is what makes a
        long French paragraph readable and stops an equation-heavy answer
        sprawling. `QuestionBody` prefers `content_latex` over `content_text`
        and repairs the Symbol-font codepoints, so mathematics arrives as
        mathematics rather than as blank boxes.
      */}
      <div className="pt-4">
        <QuestionBody contentText={contentText} contentLatex={contentLatex} images={images} />
      </div>
    </article>
  );
}

/** "4", not "4.0"; "2.5" survives. */
function formatMarks(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
