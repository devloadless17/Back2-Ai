-- File the past-paper questions loaded on 2026-10-05 under their real chapter.
-- `corpus:exams --no-embed` puts a new row in its subject's FIRST chapter, so
-- 500+ economics, sociology and civics questions were practised under one
-- chapter. Each moves to the chapter of its subject whose best course passage
-- is closest to the question's embedding (the ranking link-chapters uses, in
-- each database's own embedding space, so no score floor), and its home
-- question_chapters link moves with it. Only rows created that day and still
-- in the first chapter; nothing else is touched.
-- Undo: UPDATE questions q SET chapter_id = b.old_chapter FROM backup_refile_new_20261005 b WHERE b.id = q.id;
--       DELETE FROM question_chapters qc USING backup_refile_new_20261005 b WHERE qc.question_id = b.id AND qc.chapter_id = b.new_chapter AND b.new_chapter <> b.old_chapter;
--       INSERT INTO question_chapters (question_id, chapter_id) SELECT id, old_chapter FROM backup_refile_new_20261005 ON CONFLICT DO NOTHING;
BEGIN;
CREATE TABLE backup_refile_new_20261005 AS
WITH firsts AS (
  SELECT DISTINCT ON (subject_id) subject_id, id AS chapter_id FROM chapters ORDER BY subject_id, order_index, id
), todo AS (
  SELECT q.id, q.chapter_id AS old_chapter, f.subject_id
    FROM questions q JOIN firsts f ON f.chapter_id = q.chapter_id
   WHERE q.source_type = 'past_exam' AND q.verified_status <> 'rejected'
     AND q.created_at >= '2026-10-05' AND q.created_at < '2026-10-06' AND q.embedding IS NOT NULL
)
SELECT t.id, t.old_chapter, best.chapter_id AS new_chapter, best.similarity
  FROM todo t
  CROSS JOIN LATERAL (
    SELECT c.id AS chapter_id, max(1 - (cc.embedding <=> q.embedding)) AS similarity
      FROM questions q
      JOIN chapters c ON c.subject_id = t.subject_id
      JOIN chapter_content_chunks j ON j.chapter_id = c.id
      JOIN content_chunks cc ON cc.id = j.chunk_id
     WHERE q.id = t.id AND cc.embedding IS NOT NULL
     GROUP BY c.id
     ORDER BY similarity DESC, c.id
     LIMIT 1) best;
UPDATE questions q SET chapter_id = b.new_chapter FROM backup_refile_new_20261005 b WHERE b.id = q.id AND b.new_chapter <> b.old_chapter;
INSERT INTO question_chapters (question_id, chapter_id, score)
SELECT id, new_chapter, similarity FROM backup_refile_new_20261005 ON CONFLICT DO NOTHING;
DELETE FROM question_chapters qc USING backup_refile_new_20261005 b
 WHERE qc.question_id = b.id AND qc.chapter_id = b.old_chapter AND b.new_chapter <> b.old_chapter;
SELECT count(*) AS considered, count(*) FILTER (WHERE new_chapter <> old_chapter) AS moved FROM backup_refile_new_20261005;
COMMIT;
