'use client';

import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';

import { cn } from '@/lib/cn';

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

const REMARK = [remarkMath];
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
        {children}
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
              src={key.startsWith('http') ? key : `/api/files/${key}`}
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
