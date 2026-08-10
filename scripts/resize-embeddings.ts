/**
 * Changes the width of every embedding column and re-embeds the corpus.
 *
 *   npm run vector:resize
 *
 * Changing EMBEDDING_MODEL or EMBEDDING_DIM is not a config-only change: the
 * vectors already in the database were produced by the old model and are
 * meaningless to the new one. Mixing them does not error — it silently returns
 * wrong nearest neighbours, which surfaces as an assistant that answers
 * confidently from the wrong material. So this script drops every vector,
 * alters the columns, rebuilds the indexes, and re-embeds from scratch.
 *
 * It is destructive to embeddings only. No question, chunk or student row is
 * touched.
 */

import { PrismaClient } from '@prisma/client';

import { embedPending } from '../src/lib/ingestion';

const db = new PrismaClient();

const TABLES = ['questions', 'content_chunks', 'generated_problems', 'user_references'] as const;

const INDEXES: Record<(typeof TABLES)[number], string> = {
  questions: 'questions_embedding_hnsw_idx',
  content_chunks: 'content_chunks_embedding_hnsw_idx',
  generated_problems: 'generated_problems_embedding_hnsw_idx',
  user_references: 'user_references_embedding_hnsw_idx',
};

async function currentDimensions(): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<{ table_name: string; dimensions: number }[]>`
    SELECT c.relname AS table_name, a.atttypmod AS dimensions
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE a.attname = 'embedding' AND t.typname = 'vector' AND c.relkind = 'r'
  `;
  return new Map(rows.map((row) => [row.table_name, row.dimensions]));
}

async function main() {
  const target = Number(process.env.EMBEDDING_DIM ?? 1536);
  if (!Number.isInteger(target) || target <= 0) {
    throw new Error(`EMBEDDING_DIM must be a positive integer, got "${process.env.EMBEDDING_DIM}".`);
  }

  const existing = await currentDimensions();
  console.log(`Target dimension: ${target}`);
  for (const [table, dim] of existing) console.log(`  ${table}: currently ${dim}`);

  const needsResize = TABLES.filter((table) => existing.get(table) !== target);

  if (needsResize.length === 0) {
    console.log('All embedding columns are already the target width.');
  } else {
    for (const table of needsResize) {
      console.log(`Resizing ${table}…`);
      // Index first — an HNSW index cannot survive its column changing type.
      await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${INDEXES[table]}"`);
      await db.$executeRawUnsafe(`UPDATE "${table}" SET embedding = NULL WHERE embedding IS NOT NULL`);
      await db.$executeRawUnsafe(
        `ALTER TABLE "${table}" ALTER COLUMN embedding TYPE vector(${target}) USING NULL`,
      );
      await db.$executeRawUnsafe(
        `CREATE INDEX "${INDEXES[table]}" ON "${table}" USING hnsw (embedding vector_cosine_ops)`,
      );
      console.log(`  ${table}: resized, vectors cleared, index rebuilt.`);
    }
  }

  console.log('');
  console.log('Re-embedding the corpus…');
  const counts = await embedPending();
  console.log(`  questions: ${counts.questions}`);
  console.log(`  course-material chunks: ${counts.chunks}`);
  console.log('');
  console.log('Note: personal reference documents are re-embedded the next time they are used,');
  console.log('or you can re-upload them. They are per-student and are not backfilled in bulk.');
}

main()
  .catch((error) => {
    console.error('Resize failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
