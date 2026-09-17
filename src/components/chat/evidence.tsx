'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';

/**
 * Where Nour got this from.
 *
 * THE MOST IMPORTANT COMPONENT IN THE PRODUCT, and the one that answers the
 * question a student cannot otherwise ask: why is this not just ChatGPT with a
 * Lebanese accent? The answer is a ministry paper from 2019 with its own
 * marking scheme, and until now that fact reached the browser and was thrown
 * away.
 *
 * WHAT IT WILL NOT SHOW. No similarity score, no tier number, no "vector",
 * no "retrieved context". Those are our architecture. A student shown "0.84"
 * is being asked to make a judgement that nobody outside this codebase can
 * make, and it would turn a trust signal into a thing to be suspicious of.
 *
 * "OFFICIAL" IS SPENT CAREFULLY. It appears only where `provenance.official` is
 * true, which requires the row to be tied to a real exam cycle. Textbook
 * passages are labelled textbook and the student's own uploads are labelled as
 * theirs. The word is worth something precisely because it is not on
 * everything.
 *
 * COLLAPSED BY DEFAULT, because the answer is what the student came for and a
 * wall of citations above it would bury the teaching. The summary line is one
 * sentence; the sources are one tap away.
 */

export type EvidenceSource = {
  id: string;
  kind: 'question' | 'content_chunk' | 'user_reference';
  label: string;
  provenance?: {
    official: boolean;
    examYear?: number | null;
    examSession?: string | null;
    marks?: number | null;
    hasBareme?: boolean;
    hasSolution?: boolean;
    chapterName?: string | null;
    chapterId?: string | null;
    subjectId?: string | null;
    chunkKind?: string | null;
    fileName?: string | null;
  };
};

/**
 * Ranked by what a student should trust most.
 *
 * An official paper outranks a textbook page, which outranks the student's own
 * upload — the same order the retrieval tiers already use, surfaced as
 * hierarchy rather than as a number.
 */
function rank(source: EvidenceSource): number {
  if (source.provenance?.official) return 0;
  if (source.kind === 'content_chunk') return 1;
  return 2;
}

export function Evidence({ sources }: { sources: EvidenceSource[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  if (sources.length === 0) return null;

  const ordered = [...sources].sort((a, b) => rank(a) - rank(b));
  const officialCount = ordered.filter((s) => s.provenance?.official).length;

  /*
   * The summary names the strongest thing in the set rather than counting
   * everything equally. "Grounded in 3 Bac sources" is true and flat;
   * "Official exam paper + 2 more" is true and tells the student which fact
   * matters.
   */
  const summary =
    officialCount > 0
      ? t.evidence.summaryOfficial.replace('{count}', String(officialCount))
      : t.evidence.summaryMaterial.replace('{count}', String(ordered.length));

  return (
    <div className="mt-4 border-t border-rule pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'group flex w-full items-center gap-2 rounded text-start',
          'text-caption text-ink-muted transition-colors hover:text-ink',
        )}
      >
        {/*
          A filled dot for official, hollow for everything else. It is the
          quietest possible hierarchy — no badge, no colour beyond the brand —
          and it reads before the words do.
        */}
        <span
          aria-hidden
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            officialCount > 0 ? 'bg-primary' : 'border border-ink-faint',
          )}
        />
        <span className="flex-1 truncate font-medium">{summary}</span>
        <span aria-hidden className="text-ink-faint transition-transform duration-150">
          {open ? '−' : '+'}
        </span>
      </button>

      {open && (
        <ul className="mt-3 space-y-2.5">
          {ordered.map((source) => (
            <SourceItem key={source.id} source={source} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SourceItem({ source }: { source: EvidenceSource }) {
  const { t } = useI18n();
  const p = source.provenance;

  /*
   * The heading is the strongest true statement about this row, in the
   * student's own vocabulary. Not the internal `kind`.
   */
  const heading = p?.official
    ? t.evidence.officialExam
    : source.kind === 'content_chunk'
      ? t.evidence.textbook
      : source.kind === 'user_reference'
        ? t.evidence.yourDocument
        : t.evidence.pastQuestion;

  /*
   * Facts only, joined with a middot, and each one omitted when absent rather
   * than printed as "unknown". A source line that says "2019 · Session 1 ·
   * 4 marks" is evidence; one that says "— · — · —" is an apology.
   */
  const facts = [
    p?.examYear ? String(p.examYear) : null,
    p?.examSession ? sessionLabel(p.examSession, t.evidence.session) : null,
    p?.marks ? t.evidence.marks.replace('{count}', String(p.marks)) : null,
    p?.chunkKind ? kindLabel(p.chunkKind, t.evidence.kinds) : null,
    p?.fileName ?? null,
  ].filter(Boolean);

  /*
   * A link only where both ids exist. The brief is explicit that a fake route
   * is worse than no route, and a chapter id without its subject cannot build
   * `/practice/{subject}/{chapter}`.
   */
  const href =
    p?.chapterId && p?.subjectId ? `/practice/${p.subjectId}/${p.chapterId}` : null;

  const body = (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-caption font-semibold text-ink">{heading}</span>
        {facts.length > 0 && (
          <span className="text-caption tabular-nums text-ink-faint">{facts.join(' · ')}</span>
        )}
      </div>

      {p?.chapterName && (
        <p className="mt-0.5 truncate text-caption text-ink-muted">{p.chapterName}</p>
      )}

      {/*
        What else the paper carries. Only shown when true, and phrased as a
        property of the source rather than as a badge: a student reading
        "with marking scheme" learns something about the Bac, and a student
        reading a coloured pill learns something about our UI.
      */}
      {(p?.hasSolution || p?.hasBareme) && (
        <p className="mt-0.5 text-caption text-ink-faint">
          {[p?.hasSolution ? t.evidence.withSolution : null, p?.hasBareme ? t.evidence.withBareme : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </>
  );

  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="-mx-2 block rounded-lg px-2 py-1.5 transition-colors hover:bg-paper-sunken"
        >
          {body}
        </Link>
      ) : (
        <div className="-mx-2 px-2 py-1.5">{body}</div>
      )}
    </li>
  );
}

/** `session1` / `session2` as the papers themselves say it. */
function sessionLabel(session: string, template: string): string {
  const n = session.endsWith('2') ? '2' : '1';
  return template.replace('{n}', n);
}

/** The chunk kinds are a database enum; these are their names for a reader. */
function kindLabel(kind: string, kinds: Record<string, string>): string {
  return kinds[kind] ?? kind.replace(/_/g, ' ');
}
