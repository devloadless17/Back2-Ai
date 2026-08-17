-- Reverts 20260814190000_chunk_subject_ids, which was a fix for a problem that
-- did not exist.
--
-- The premise was that scoping through the link table stopped the planner using
-- the HNSW index, because EXPLAIN showed a sequential scan. It did — for the
-- query I tested, which joined through tracks.code and later through a temp
-- table. Retrieval sends neither. It sends an explicit list of subject uuids,
-- and with that list the planner uses the index:
--
--   EXISTS through the link table, literal ids   2.9 ms, HNSW index scan
--   subject_ids && '{...}'::uuid[]              43.6 ms, sequential scan
--
-- So the denormalised column was slower than the join it replaced, and its
-- trigger charged an UPDATE for every one of the 17,829 links a corpus load
-- writes. Dropped.
--
-- The lesson is in the shape of the test, not the schema: an EXPLAIN of a query
-- your application does not send tells you about a query nobody runs.

DROP TRIGGER IF EXISTS chapter_content_chunks_sync_subjects ON "chapter_content_chunks";
DROP FUNCTION IF EXISTS sync_chunk_subject_ids();
DROP FUNCTION IF EXISTS chunk_subject_ids(UUID);
DROP INDEX IF EXISTS "content_chunks_subject_ids_idx";
ALTER TABLE "content_chunks" DROP COLUMN IF EXISTS "subject_ids";
