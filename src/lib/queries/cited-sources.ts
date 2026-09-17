import 'server-only';

import { db } from '@/lib/db';
import type { EvidenceSource } from '@/components/chat/evidence';

/**
 * Rebuilds the provenance of an answer that was written earlier.
 *
 * WHY THIS IS NEEDED. Evidence reaches the browser on the `meta` event, before
 * the first token — which covers exactly one case: the answer being streamed
 * right now. Reload the page, or open yesterday's conversation, and every
 * answer lost the thing that made it trustworthy. `chat_messages` stores the
 * ids it cited; this turns them back into sources.
 *
 * THE IDS DO NOT SAY WHAT THEY ARE. `cited_source_ids` is a flat uuid array
 * covering three different tables, because that is what was stored. So all
 * three are asked, and whichever answers owns the row. Not elegant, and it is
 * three indexed lookups on a page that is already doing a session read — the
 * alternative is a migration that rewrites history nobody can reconstruct.
 *
 * A row that has since been deleted simply does not come back. A conversation
 * from before a re-ingestion shows fewer sources rather than a broken one, and
 * an answer with none renders without an evidence block — which is honest: we
 * no longer hold what it was grounded in.
 */
export async function citedSources(ids: string[]): Promise<Map<string, EvidenceSource>> {
  const found = new Map<string, EvidenceSource>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return found;

  const [questions, chunks, references] = await Promise.all([
    db.$queryRaw<
      {
        id: string;
        chapter_name: string;
        chapter_id: string;
        subject_id: string;
        year: number | null;
        session: string | null;
        marks: number | null;
        has_bareme: boolean;
        has_solution: boolean;
      }[]
    >`
      SELECT q.id::text, c.name AS chapter_name, c.id::text AS chapter_id,
             c.subject_id::text AS subject_id,
             ec.year, ec.session::text AS session,
             -- CASE rather than a filter inside the subquery: the set-returning
             -- function runs before the WHERE and raises on a non-array.
             CASE WHEN jsonb_typeof(q.bareme) = 'array'
               THEN (SELECT sum((item->>'points')::numeric)
                       FROM jsonb_array_elements(q.bareme) item)
             END AS marks,
             (q.bareme IS NOT NULL AND jsonb_typeof(q.bareme) = 'array'
               AND jsonb_array_length(q.bareme) > 0) AS has_bareme,
             (q.official_solution IS NOT NULL AND length(trim(q.official_solution)) > 0)
               AS has_solution
        FROM questions q
        JOIN chapters c ON c.id = q.chapter_id
        LEFT JOIN exam_cycles ec ON ec.id = q.source_exam_id
       WHERE q.id = ANY(${unique}::uuid[])`,

    db.$queryRaw<
      { id: string; kind: string; chapter_name: string | null; chapter_id: string | null; subject_id: string | null }[]
    >`
      SELECT cc.id::text, cc.kind::text AS kind,
             c.name AS chapter_name, c.id::text AS chapter_id, c.subject_id::text AS subject_id
        FROM content_chunks cc
        LEFT JOIN LATERAL (
          SELECT ch.* FROM chapter_content_chunks l
            JOIN chapters ch ON ch.id = l.chapter_id
           WHERE l.chunk_id = cc.id LIMIT 1
        ) c ON true
       WHERE cc.id = ANY(${unique}::uuid[])`,

    db.$queryRaw<{ id: string; file_name: string | null }[]>`
      SELECT id::text, file_name FROM user_references WHERE id = ANY(${unique}::uuid[])`,
  ]);

  for (const row of questions) {
    found.set(row.id, {
      id: row.id,
      kind: 'question',
      label: row.chapter_name,
      provenance: {
        official: row.year !== null,
        examYear: row.year,
        examSession: row.session,
        marks: row.marks === null ? null : Number(row.marks),
        hasBareme: row.has_bareme,
        hasSolution: row.has_solution,
        chapterName: row.chapter_name,
        chapterId: row.chapter_id,
        subjectId: row.subject_id,
      },
    });
  }

  for (const row of chunks) {
    found.set(row.id, {
      id: row.id,
      kind: 'content_chunk',
      label: row.chapter_name ?? row.kind,
      provenance: {
        official: false,
        chapterName: row.chapter_name,
        chapterId: row.chapter_id,
        subjectId: row.subject_id,
        chunkKind: row.kind,
      },
    });
  }

  for (const row of references) {
    found.set(row.id, {
      id: row.id,
      kind: 'user_reference',
      label: row.file_name ?? '',
      provenance: { official: false, fileName: row.file_name },
    });
  }

  return found;
}
