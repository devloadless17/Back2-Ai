-- SE papers filed under the wrong subject (found 2026-10-04 reading SE answers).
-- se/2009 1/chem_en.pdf was the maths paper; se/2019 {1,2}/ektesad_crdp.pdf were
-- sociology (CRDP titles "اجتماع - …"); se/2019 2/ektesad_crdp4.pdf is an
-- Arabic-edition maths paper. The papers are now loaded under their own subject
-- (maths, sociology); these are the copies left under chemistry/economics.
-- Hidden, not deleted; undo: UPDATE questions q SET verified_status = b.verified_status
--   FROM backup_se_misfiled_20261004 b WHERE b.id = q.id;
CREATE TABLE backup_se_misfiled_20261004 AS
SELECT q.id, q.verified_status
  FROM questions q JOIN exam_cycles e ON e.id = q.source_exam_id
 WHERE q.verified_status <> 'rejected' AND (
       (e.title = 'Chemistry SE 2009 — session 1' AND (
            q.content_text LIKE 'A factory produces watches%'
         OR q.content_text LIKE 'The table below shows the turnover%'
         OR q.content_text LIKE 'Consider the function g defined%'
         OR q.content_text LIKE 'During the year 1990, a factory produced%'))
    OR (e.title IN ('اقتصاد SE 2019 — session 1', 'اقتصاد SE 2019 — session 2') AND (
            q.content_text LIKE 'سمّ المفهوم أو المصطلح الاجتماعي%'
         OR q.content_text LIKE 'سم المفهوم الاجتماعي%'
         OR q.content_text LIKE 'يبين الجدول ادناه عدد سكان%'
         OR q.content_text LIKE 'القسم الأول%لتكن f الدالة%'
         OR q.content_text LIKE 'في نادي رياضي%')));
UPDATE questions SET verified_status = 'rejected'
 WHERE id IN (SELECT id FROM backup_se_misfiled_20261004);
SELECT count(*) AS hidden FROM backup_se_misfiled_20261004;

-- se/2019 1/geo_crdp.pdf III ("link the columns": Switzerland, South Korea,
-- Saudi Arabia) stores exercise V's answer as its solution (multinationals'
-- revenues). arabic_parts.py refuses its parts, so the stored text would still
-- show; it is cleared, and the page offers the answer written on request.
CREATE TABLE backup_se_wrong_solution_20261004 AS
SELECT q.id, q.official_solution, q.official_solution_latex, q.bareme
  FROM questions q JOIN exam_cycles e ON e.id = q.source_exam_id
 WHERE e.title = 'جغرافيا SE 2019 — session 1' AND q.verified_status <> 'rejected'
   AND q.content_text LIKE '%سويسرا%' AND q.content_text LIKE '%كوريا الجنوبية%'
   AND q.official_solution LIKE '%الاستنتاج: السبب الذي جعل شركات الولايات المتحدة%';
UPDATE questions SET official_solution = NULL, official_solution_latex = NULL
 WHERE id IN (SELECT id FROM backup_se_wrong_solution_20261004);
SELECT count(*) AS cleared FROM backup_se_wrong_solution_20261004;
