-- Somewhere to keep a generated chapter summary.
--
-- Until now there was nowhere, and the page said so: "Written on request and
-- not cached, which is the honest state of this page rather than a design
-- choice." Every view of a chapter summary paid for a model call over the whole
-- chapter, and a chapter summarised in eight batches paid for eight.
--
-- Keyed on the chapter and carrying the passage ids it was written from, so a
-- re-chunked chapter invalidates its own summary instead of serving a summary
-- of material that no longer exists.
CREATE TABLE "chapter_summaries" (
  "chapter_id"       UUID PRIMARY KEY REFERENCES "chapters"("id") ON DELETE CASCADE,
  "overview"         TEXT        NOT NULL,
  "key_points"       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  "watch_out"        TEXT[]      NOT NULL DEFAULT '{}',
  "batched"          BOOLEAN     NOT NULL DEFAULT false,
  "source_chunk_ids" UUID[]      NOT NULL DEFAULT '{}',
  "model_used"       TEXT,
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
