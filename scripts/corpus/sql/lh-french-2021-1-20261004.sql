-- lh/2021 1/LH_Fran_2021_1.pdf was first read as its footnote glossary
-- ("réquisitoire : discours contenant de violentes attaques…"), and that row was
-- hidden. Reloaded 2026-10-04 from the parts lang_parts.py reads
-- (corpus:exams --from corpus/.mapping/lh-fix/lh-fr2021-1.json corrects it in
-- place, same source_ref), so it is shown again.
-- Undo: UPDATE questions q SET verified_status = b.verified_status
--   FROM backup_lh_french_2021_1_20261004 b WHERE b.id = q.id;
CREATE TABLE backup_lh_french_2021_1_20261004 AS
SELECT q.id, q.verified_status
  FROM questions q JOIN exam_cycles e ON e.id = q.source_exam_id
 WHERE e.title = 'Francais LH 2021 — session 1' AND q.order_index = 0
   AND q.verified_status = 'rejected'
   AND q.content_text LIKE '1. En vous appuyant sur le texte et son chapeau%';
UPDATE questions SET verified_status = 'unverified'
 WHERE id IN (SELECT id FROM backup_lh_french_2021_1_20261004);
SELECT count(*) AS shown FROM backup_lh_french_2021_1_20261004;
