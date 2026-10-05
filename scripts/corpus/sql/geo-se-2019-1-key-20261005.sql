-- جغرافيا SE 2019 — session 1 (se/2019 1/geo_crdp.pdf), exercises ثانياً and ثالثاً.
-- The answer matcher kept only the starred marking notes of the key — and the
-- second note belongs to ثالثاً — so the multiple choice "answer" was
-- "علامتان لأربع إجابات: نصف علامة لكل إجابة صحيحة", and the matching
-- exercise had nothing. Both are written here from the printed key (page 3 of
-- the PDF, corpus/exams-ocr/62603681/page-003.md). The only row in the
-- Arabic-taught corpus whose answer was notes alone (checked 2026-10-05).
-- Rows are found by content, so this runs on any database.
-- Undo: UPDATE questions q SET official_solution = b.official_solution, paper_parts = b.paper_parts
--   FROM backup_geo_se_2019_1_key_20261005 b WHERE b.id = q.id;
BEGIN;

CREATE TABLE backup_geo_se_2019_1_key_20261005 AS
SELECT q.id, q.official_solution, q.paper_parts
  FROM questions q JOIN exam_cycles e ON e.id = q.source_exam_id
 WHERE e.title = 'جغرافيا SE 2019 — session 1' AND q.verified_status <> 'rejected'
   AND (q.content_text LIKE 'من خلال المستند رقم (١)، اختر الإجابة الصحيحة%'
        OR q.content_text LIKE 'من خلال المستندين رقم (١) ورقم ٢(أ- ب)، أربط%');

-- ثانياً: multiple choice — one answer per part, and the whole key.
UPDATE questions q
   SET official_solution = E'(1) - ب\n(2) - أ\n(3) - ب\n(4) - ج\n\nعلامتان لأربع إجابات: نصف علامة لكل إجابة صحيحة.',
       paper_parts = CASE WHEN jsonb_array_length(q.paper_parts->'parts') = 4 THEN
         jsonb_set(jsonb_set(jsonb_set(jsonb_set(q.paper_parts,
           '{parts,0,answer}', '"(1) - ب"'), '{parts,1,answer}', '"(2) - أ"'),
           '{parts,2,answer}', '"(3) - ب"'), '{parts,3,answer}', '"(4) - ج"')
         ELSE q.paper_parts END
  FROM backup_geo_se_2019_1_key_20261005 b
 WHERE b.id = q.id AND q.content_text LIKE 'من خلال المستند رقم (١)، اختر الإجابة الصحيحة%';

-- ثالثاً: matching.
UPDATE questions q
   SET official_solution = E'(1) ← هـ\n(2) ← أ\n(3) ← ج\n(4) ← د\nالمشتت: (ب)\n\nعلامتان لأربع إجابات صحيحة: نصف علامة لكل إجابة، لا يخص للمشتت أي علامة.'
  FROM backup_geo_se_2019_1_key_20261005 b
 WHERE b.id = q.id AND q.content_text LIKE 'من خلال المستندين رقم (١) ورقم ٢(أ- ب)، أربط%';

SELECT count(*) AS rows_fixed FROM backup_geo_se_2019_1_key_20261005;
COMMIT;
