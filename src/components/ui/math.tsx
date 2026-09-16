'use client';

import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';

import { cn } from '@/lib/cn';
import { repairSymbolFont } from '@/lib/symbol-font';

/**
 * Question, solution and explanation bodies.
 *
 * Everything a student reads as *content* — as opposed to interface text — goes
 * through here. Content is authored as Markdown with LaTeX in `$…$` / `$$…$$`,
 * which is what both the ingestion pipeline and the model produce.
 *
 * Rendering is deliberately narrow: no raw HTML is allowed through. Question
 * text arrives from OCR of scanned papers and from model output, and neither is
 * a trustworthy source of markup.
 */

/*
 * A newline in a question is a line the examiner printed.
 *
 * Markdown does not agree: a single newline is a soft break and collapses to a
 * space, so only a blank line starts anything new. Exam papers are not written
 * that way. A chemistry question arrives with its parts on their own lines —
 *
 *   The measured pH of solution (S') is 2.53.
 *   1- Calculate the concentration C' of chloroacetic acid.
 *   2- Deduce the effect of dilution on the degree of dissociation.
 *   3- A new titration is carried out...
 *
 * — and rendered as Markdown that becomes one run-on paragraph with "1-",
 * "2-" and "3-" buried mid-sentence. The newlines were never lost; that
 * question has 44 of them in the database. They were being discarded at the
 * last step, which is why re-extracting never fixed it.
 *
 * `remarkBreaks` turns each soft break into a hard one. It runs after
 * `remarkMath`, so display math has already been parsed into its own nodes and
 * a break can never be inserted inside a formula.
 */
/**
 * Symbols the papers stored as private-use codepoints, put back before render.
 *
 * Lebanese exam papers set their mathematics in the Adobe Symbol font, and a
 * PDF embedding Symbol writes each glyph at `0xF000 + its byte`. Extraction kept
 * those codepoints faithfully; nothing downstream knows what they mean. 891 of
 * the 1,158 questions carrying LaTeX contain them. `Δm = m₁ - m₂` reaches this
 * component as a blank box followed by `m = m₁ - m₂`, and inside `$…$` it is not
 * even a blank box — KaTeX cannot parse it, so the student is shown the raw
 * source of the formula in red.
 *
 * DONE AT RENDER RATHER THAN IN THE DATABASE, deliberately. Rewriting 891 rows
 * is a migration that cannot be undone if the mapping turns out to be wrong
 * anywhere, and a mapping wrong in one place prints a different equation to
 * somebody sitting a national exam. Here it is a pure function over text, the
 * stored bytes stay exactly as the paper had them, and correcting the table
 * corrects every screen at once. It costs one pass over a string that is about
 * to be parsed as Markdown anyway.
 */
const REMARK = [remarkMath, remarkBreaks];
const REHYPE = [rehypeKatex];



export function MathText({
  children,
  className,
  compact = false,
}: {
  children: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn(compact ? 'text-sm leading-relaxed' : 'prose-exam', 'scroll-x', className)}>
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} skipHtml>
        {repairSymbolFont(children)}
      </ReactMarkdown>
    </div>
  );
}

/**
 * A question as it is printed on a paper: LaTeX body when the ingester captured
 * one, plain text otherwise. Never both — `content_latex` is the same question,
 * not an addition to it.
 *
 * Figures are separate. Physics and maths papers carry circuit diagrams, graphs
 * and geometric constructions that the transcription records only as
 * `[figure: …]`, and a question whose diagram is missing is a question that
 * cannot be answered. They are served through the authenticated file route like
 * everything else in storage.
 */
export function QuestionBody({
  contentText,
  contentLatex,
  images,
  className,
}: {
  contentText: string;
  contentLatex?: string | null;
  images?: string[] | null;
  className?: string;
}) {
  return (
    <div className={className}>
      <MathText>{contentLatex || contentText}</MathText>

      {images && images.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {images.map((key) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={key}
              /*
               * Three kinds of key, and the distinction is about ownership.
               *
               * `/api/files/...` is the default because most images here are a
               * student's own photographed work, and that route checks who owns
               * the key before streaming a byte. A leading slash means a file
               * served straight from `public/` — exam-paper figures, which are
               * published documents with nothing private in them and no owner
               * to check. Putting those behind the ownership route would mean
               * inventing an owner for a page of a national exam.
               */
              src={key.startsWith('http') || key.startsWith('/') ? key : `/api/files/${key}`}
              alt=""
              className="max-h-72 w-auto max-w-full rounded border border-rule bg-paper-raised"
              loading="lazy"
            />
          ))}
        </div>
      )}
    </div>
  );
}
