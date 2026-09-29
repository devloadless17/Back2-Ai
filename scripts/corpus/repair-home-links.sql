-- Give every question the question_chapters row for its own chapter.
--
-- The practice page lists what a chapter can SERVE (question_chapters); the
-- loader files a question with questions.chapter_id AND is meant to write that
-- home row. Where it did not, a chapter counts as having questions everywhere
-- that reads chapter_id, and opens empty — "No practice questions for this
-- chapter yet" on a chapter "Next up" had just recommended. Idempotent.
--
--   psql -v ON_ERROR_STOP=1 -f repair-home-links.sql
-- Undo: DELETE FROM question_chapters WHERE (question_id, chapter_id) IN
--       (SELECT question_id, chapter_id FROM repair_home_links_added);
BEGIN;
SELECT count(*) AS questions_missing_home_link
  FROM questions q
 WHERE q.verified_status <> 'rejected'
   AND NOT EXISTS (SELECT 1 FROM question_chapters qc WHERE qc.question_id = q.id AND qc.chapter_id = q.chapter_id);
CREATE TABLE IF NOT EXISTS repair_home_links_added (question_id uuid, chapter_id uuid, added_at timestamptz DEFAULT now());
WITH added AS (
  INSERT INTO question_chapters (question_id, chapter_id)
  SELECT q.id, q.chapter_id FROM questions q
   WHERE q.verified_status <> 'rejected'
     AND NOT EXISTS (SELECT 1 FROM question_chapters qc WHERE qc.question_id = q.id AND qc.chapter_id = q.chapter_id)
  ON CONFLICT DO NOTHING
  RETURNING question_id, chapter_id)
INSERT INTO repair_home_links_added (question_id, chapter_id) SELECT question_id, chapter_id FROM added;
SELECT count(*) AS still_missing
  FROM questions q
 WHERE q.verified_status <> 'rejected'
   AND NOT EXISTS (SELECT 1 FROM question_chapters qc WHERE qc.question_id = q.id AND qc.chapter_id = q.chapter_id);
COMMIT;
