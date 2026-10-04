-- se/2008 2/eng.pdf was byte for byte the chemistry paper SE and LH sat that
-- session (lh/2008 2/chem_en.pdf). Renamed chem_en.pdf and loaded under SE
-- chemistry (corpus:exams --from corpus/.mapping/lh-fix/se-chem2008-2.json);
-- these are the copies left under English. CRDP has no SE English paper for
-- 2008 session 2, so the English paper stays absent.
-- Undo: UPDATE questions q SET verified_status = b.verified_status
--   FROM backup_se_english_2008_2_20261005 b WHERE b.id = q.id;
CREATE TABLE backup_se_english_2008_2_20261005 AS
SELECT q.id, q.verified_status
  FROM questions q JOIN exam_cycles e ON e.id = q.source_exam_id
 WHERE e.title = 'English SE 2008 — session 2' AND q.verified_status <> 'rejected'
   AND (q.content_text LIKE 'Alcoholism and Malnutrition%' OR q.content_text LIKE 'Sertraline Hydrochloride%');
UPDATE questions SET verified_status = 'rejected'
 WHERE id IN (SELECT id FROM backup_se_english_2008_2_20261005);
SELECT count(*) AS hidden FROM backup_se_english_2008_2_20261005;
