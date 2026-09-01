-- The subject-level overview, cached on the same terms as the chapter one.
--
-- `summariseSubject` has existed unused since it was written. Wiring it to a
-- page render without this table would have reintroduced, one level up, the
-- exact problem the chapter cache was just built to fix: a model call over the
-- whole subject on every view.
--
-- Keyed on the subject and carrying the chapter ids it was composed from, so a
-- subject that gains or loses a chapter regenerates rather than describing a
-- syllabus that has changed underneath it.
CREATE TABLE "subject_summaries" (
  "subject_id"        UUID PRIMARY KEY REFERENCES "subjects"("id") ON DELETE CASCADE,
  "overview"          TEXT        NOT NULL,
  "chapters"          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  "source_chapter_ids" UUID[]     NOT NULL DEFAULT '{}',
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
