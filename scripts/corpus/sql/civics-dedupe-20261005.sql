-- Civics questions shown twice on one page (2017–2023 papers, 2026-10-05).
-- Two PDFs of the same exam (lh/2019 1/tarbeya.pdf and tarbeya_crdp.pdf,
-- ls/2017 1 the same) both load into one cycle, and gs/2023 1 holds two papers
-- in one file; after today's civics rebuild each copy was complete, so every
-- question appeared twice. Within a page, rows that open with the same 30
-- letters (spaces, punctuation and vowel marks ignored) are one question: the
-- one with an official answer is kept, else the longer, else the older id.
-- Hidden, not deleted.
-- Undo: UPDATE questions q SET verified_status = b.verified_status
--   FROM backup_civics_dedupe_20261005 b WHERE b.id = q.id;
BEGIN;
CREATE TABLE backup_civics_dedupe_20261005 AS
WITH live AS (
  SELECT q.id, q.verified_status, q.source_exam_id,
         left(regexp_replace(q.content_text, '[^[:alpha:]]+|[ً-ْٰ]', '', 'g'), 30) AS k,
         row_number() OVER (
           PARTITION BY q.source_exam_id, left(regexp_replace(q.content_text, '[^[:alpha:]]+|[ً-ْٰ]', '', 'g'), 30)
           ORDER BY (coalesce(q.official_solution, '') <> '') DESC, length(q.content_text) DESC, q.id) AS rn
    FROM questions q JOIN exam_cycles ec ON ec.id = q.source_exam_id JOIN subjects s ON s.id = ec.subject_id
   WHERE s.name = 'تربية وطنية' AND q.verified_status <> 'rejected' AND q.source_type = 'past_exam'
     AND ec.title ~ ' 20(17|18|19|21|23) — '
)
SELECT id, verified_status FROM live WHERE rn > 1;
UPDATE questions q SET verified_status = 'rejected' FROM backup_civics_dedupe_20261005 b WHERE b.id = q.id;
SELECT count(*) AS rows_hidden FROM backup_civics_dedupe_20261005;
COMMIT;
