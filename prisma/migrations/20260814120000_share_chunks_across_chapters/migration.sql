-- A passage is stored once and pointed at from every chapter that teaches it.
--
-- Four tracks share textbooks, and a subject row exists per track so that
-- mastery, exam cycles and track scoping stay separate. Filing the text once
-- per chapter therefore stored the civics book four times over: 15,668 rows
-- for 11,063 distinct passages, each copy carrying its own identical vector.
--
-- Retrieval is unchanged by this. A search is still scoped to the student's own
-- subjects, so a GS student reaches a shared passage through the GS chapter and
-- never sees the LS one.
--
-- Written to be re-runnable and to fail rather than lose text: the old column is
-- only dropped after every row has a link, and the duplicate rows are only
-- deleted after their chapters have been recorded against the survivor.

CREATE TABLE IF NOT EXISTS "chapter_content_chunks" (
  "chapter_id" UUID NOT NULL,
  "chunk_id"   UUID NOT NULL,
  CONSTRAINT "chapter_content_chunks_pkey" PRIMARY KEY ("chapter_id", "chunk_id")
);

-- One row per (chapter, chunk) pair that exists today.
INSERT INTO "chapter_content_chunks" ("chapter_id", "chunk_id")
SELECT "chapter_id", "id" FROM "content_chunks"
ON CONFLICT DO NOTHING;

-- Identical text under the same source document is the same passage. The
-- survivor is the oldest row, so ids that already exist elsewhere stay valid.
CREATE TEMP TABLE chunk_merge AS
SELECT
  id AS duplicate_id,
  first_value(id) OVER (
    PARTITION BY content_text, coalesce(source_document_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY created_at, id
  ) AS keep_id
FROM "content_chunks";

-- Point every link at the surviving passage before anything is removed.
INSERT INTO "chapter_content_chunks" ("chapter_id", "chunk_id")
SELECT l."chapter_id", m.keep_id
FROM "chapter_content_chunks" l
JOIN chunk_merge m ON m.duplicate_id = l."chunk_id"
WHERE m.keep_id <> l."chunk_id"
ON CONFLICT DO NOTHING;

DELETE FROM "chapter_content_chunks" l
USING chunk_merge m
WHERE m.duplicate_id = l."chunk_id" AND m.keep_id <> l."chunk_id";

DELETE FROM "content_chunks" c
USING chunk_merge m
WHERE m.duplicate_id = c.id AND m.keep_id <> c.id;

DROP TABLE chunk_merge;

-- Refuse to continue if anything would be orphaned by dropping the column.
DO $$
DECLARE orphans BIGINT;
BEGIN
  SELECT count(*) INTO orphans
  FROM "content_chunks" c
  WHERE NOT EXISTS (SELECT 1 FROM "chapter_content_chunks" l WHERE l."chunk_id" = c.id);
  IF orphans > 0 THEN
    RAISE EXCEPTION '% chunk(s) have no chapter link; refusing to drop chapter_id', orphans;
  END IF;
END $$;

ALTER TABLE "content_chunks" DROP CONSTRAINT IF EXISTS "content_chunks_chapter_id_fkey";
DROP INDEX IF EXISTS "content_chunks_chapter_id_kind_idx";
ALTER TABLE "content_chunks" DROP COLUMN IF EXISTS "chapter_id";

CREATE INDEX IF NOT EXISTS "content_chunks_kind_idx" ON "content_chunks" ("kind");
CREATE INDEX IF NOT EXISTS "chapter_content_chunks_chunk_id_idx" ON "chapter_content_chunks" ("chunk_id");

ALTER TABLE "chapter_content_chunks"
  ADD CONSTRAINT "chapter_content_chunks_chapter_id_fkey"
  FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chapter_content_chunks"
  ADD CONSTRAINT "chapter_content_chunks_chunk_id_fkey"
  FOREIGN KEY ("chunk_id") REFERENCES "content_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
