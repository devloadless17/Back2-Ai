-- Page footers ("صفحة 2 من 2") and a detached marks column ("(علامتان)" lines
-- stacked at the end, read off the margin by OCR) shown as question text in the
-- Arabic-taught past papers (Geographie GS 2019-2, found 2026-10-06). A mark in
-- brackets stays when it stands alone after its question; only a run of two or
-- more bare mark lines is the column. Question text, its LaTeX copy, and the
-- per-part text in paper_parts.
-- Undo: UPDATE questions q SET content_text = b.content_text, content_latex = b.content_latex, paper_parts = b.paper_parts
--   FROM backup_strip_footers_20261006 b WHERE b.id = q.id;
BEGIN;
CREATE FUNCTION pg_temp.clean(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN t IS NULL THEN NULL ELSE btrim(regexp_replace(regexp_replace(
    t,
    '(\s*\n[ \t]*\([^()\n]{0,25}علام[^()\n]{0,15}\)[ \t]*){2,}(?=\s*(\n|$))', '', 'g'),
    '\s*(^|\n)[ \t]*صفحة[ \t]*[0-9٠-٩]+[ \t]*(من|/)[ \t]*[0-9٠-٩]+[ \t]*(?=\s*(\n|$))', '', 'g'), E' \n\t')
  END
$$;
CREATE FUNCTION pg_temp.clean_parts(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IS NULL THEN NULL ELSE
    jsonb_set(
      CASE WHEN p ? 'intro' THEN jsonb_set(p, '{intro}', to_jsonb(pg_temp.clean(p->>'intro'))) ELSE p END,
      '{parts}',
      coalesce((SELECT jsonb_agg(CASE WHEN x ? 'text' THEN jsonb_set(x, '{text}', to_jsonb(pg_temp.clean(x->>'text'))) ELSE x END ORDER BY i)
                  FROM jsonb_array_elements(p->'parts') WITH ORDINALITY AS a(x, i)), '[]'::jsonb))
  END
$$;
CREATE TABLE backup_strip_footers_20261006 AS
SELECT q.id, q.content_text, q.content_latex, q.paper_parts
  FROM questions q JOIN chapters c ON c.id = q.chapter_id JOIN subjects s ON s.id = c.subject_id
 WHERE q.source_type = 'past_exam' AND s.language = 'ar'
   AND (pg_temp.clean(q.content_text) IS DISTINCT FROM btrim(q.content_text, E' \n\t')
        OR pg_temp.clean(q.content_latex) IS DISTINCT FROM btrim(q.content_latex, E' \n\t')
        OR (q.paper_parts ? 'parts' AND pg_temp.clean_parts(q.paper_parts) IS DISTINCT FROM q.paper_parts
            AND pg_temp.clean_parts(pg_temp.clean_parts(q.paper_parts)) = pg_temp.clean_parts(q.paper_parts)
            AND q.paper_parts::text ~ '(صفحة|علام)'));
UPDATE questions q
   SET content_text = coalesce(pg_temp.clean(q.content_text), q.content_text),
       content_latex = pg_temp.clean(q.content_latex),
       paper_parts = CASE WHEN q.paper_parts ? 'parts' THEN pg_temp.clean_parts(q.paper_parts) ELSE q.paper_parts END
  FROM backup_strip_footers_20261006 b WHERE b.id = q.id;
SELECT count(*) AS rows_cleaned FROM backup_strip_footers_20261006;
COMMIT;
