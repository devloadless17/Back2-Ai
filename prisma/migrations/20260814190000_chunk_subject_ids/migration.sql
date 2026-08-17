-- Let the vector index actually be used.
--
-- Retrieval scopes every search to the student's own subjects, and it reaches
-- them through the link table: content_chunks -> chapter_content_chunks ->
-- chapters -> subject. That join is a filter the planner has to resolve before
-- it can order by distance, so it builds the whole scoped set and sorts it.
-- Measured with EXPLAIN ANALYZE on 12,196 passages: 77ms with the filter,
-- 5ms without it, and `Seq Scan on content_chunks` in place of the HNSW index
-- scan. The index has been paying for itself in write cost and returning
-- nothing.
--
-- The fix is to put the subjects on the row, so the filter is a plain predicate
-- on the same table that pgvector can apply against index candidates.
--
-- Denormalised data drifts, so this is maintained by the database rather than
-- by whichever script happens to write a link next: two of them already create
-- chunks, and a third would forget.

ALTER TABLE "content_chunks"
  ADD COLUMN IF NOT EXISTS "subject_ids" UUID[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION chunk_subject_ids(chunk UUID) RETURNS UUID[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(DISTINCT c.subject_id), '{}')
  FROM chapter_content_chunks l
  JOIN chapters c ON c.id = l.chapter_id
  WHERE l.chunk_id = chunk
$$;

CREATE OR REPLACE FUNCTION sync_chunk_subject_ids() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  target UUID := coalesce(NEW.chunk_id, OLD.chunk_id);
BEGIN
  UPDATE content_chunks
  SET subject_ids = chunk_subject_ids(target)
  WHERE id = target;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS chapter_content_chunks_sync_subjects ON "chapter_content_chunks";
CREATE TRIGGER chapter_content_chunks_sync_subjects
  AFTER INSERT OR DELETE ON "chapter_content_chunks"
  FOR EACH ROW EXECUTE FUNCTION sync_chunk_subject_ids();

-- Backfill what is already there.
UPDATE content_chunks cc SET subject_ids = chunk_subject_ids(cc.id);

CREATE INDEX IF NOT EXISTS "content_chunks_subject_ids_idx"
  ON "content_chunks" USING gin ("subject_ids");
