-- Free text repair for Arabic-subject questions. Reversible:
--   UPDATE questions q SET content_text=b.content_text, content_latex=b.content_latex,
--     official_solution=b.official_solution, official_solution_latex=b.official_solution_latex,
--     bareme=b.bareme FROM backup_arabic_textfix_20260924 b WHERE b.id=q.id;
BEGIN;

CREATE TABLE backup_arabic_textfix_20260924 AS
SELECT q.id, q.content_text, q.content_latex, q.official_solution, q.official_solution_latex, q.bareme
FROM questions q
JOIN chapters c ON c.id = q.chapter_id
JOIN subjects s ON s.id = c.subject_id
WHERE s.language = 'ar'
  AND (   q.content_text ~ ' +[ً-ْ]' OR q.content_text ~ 'ھ'
       OR q.content_latex ~ ' +[ً-ْ]' OR q.content_latex ~ 'ھ'
       OR q.official_solution ~ ' +[ً-ْ]' OR q.official_solution ~ 'ھ'
       OR q.official_solution_latex ~ ' +[ً-ْ]' OR q.official_solution_latex ~ 'ھ'
       OR q.bareme::text ~ ' +[ً-ْ]' OR q.bareme::text ~ 'ھ');

UPDATE questions q SET
  content_text            = regexp_replace(regexp_replace(q.content_text, ' +([ً-ْ])', '\1', 'g'), 'ھ', 'ه', 'g'),
  content_latex           = regexp_replace(regexp_replace(q.content_latex, ' +([ً-ْ])', '\1', 'g'), 'ھ', 'ه', 'g'),
  official_solution       = regexp_replace(regexp_replace(q.official_solution, ' +([ً-ْ])', '\1', 'g'), 'ھ', 'ه', 'g'),
  official_solution_latex = regexp_replace(regexp_replace(q.official_solution_latex, ' +([ً-ْ])', '\1', 'g'), 'ھ', 'ه', 'g'),
  bareme = CASE WHEN q.bareme IS NULL THEN NULL
    ELSE regexp_replace(regexp_replace(q.bareme::text, ' +([ً-ْ])', '\1', 'g'), 'ھ', 'ه', 'g')::jsonb END
FROM backup_arabic_textfix_20260924 b
WHERE b.id = q.id;

SELECT (SELECT count(*) FROM backup_arabic_textfix_20260924) AS rows_backed_up_and_fixed,
       count(*) FILTER (WHERE q.content_text ~ ' +[ً-ْ]' OR q.content_text ~ 'ھ') AS still_damaged
FROM questions q JOIN chapters c ON c.id = q.chapter_id JOIN subjects s ON s.id = c.subject_id
WHERE s.language = 'ar';

COMMIT;
