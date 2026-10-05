-- The next exercise's heading shown as the last line of the one before it
-- ("…exceed 3 million? Justify.  II- Exponential Functions (5 points)").
-- Found 2026-10-05 in an exam simulation. C1 ends a span where the next
-- statement starts, so on the 2024 session 1 maths papers (all four tracks,
-- EN and FR) the heading printed between two exercises fell into the earlier
-- one: 31 rows locally, in content_latex and in the last part of paper_parts.
-- display_text.py now drops such a line; this cleans the rows already loaded.
--
-- Same rule as display_text.py `is_next_heading`: the last line has a
-- heading's shape — "II- Title (5 points)", "Exercise 2 (7 points)" — AND the
-- extractor's own text (content_text) does not have it. The second half keeps
-- a real last question like "IV- Deduce x. (1 pt)". content_text is untouched,
-- so search and embeddings do not change.
--
-- Undo: UPDATE questions q SET content_latex = b.content_latex, paper_parts = b.paper_parts
--   FROM backup_next_heading_20261005 b WHERE b.id = q.id;
BEGIN;

CREATE FUNCTION pg_temp.tail_line(x text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT substring(regexp_replace(x, '\s+$', '') from '[^\n]*$')
$$;

CREATE FUNCTION pg_temp.squash(x text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(regexp_replace(lower(x), '[^[:alnum:]]+', ' ', 'g'))
$$;

CREATE FUNCTION pg_temp.heading_tail(x text, canonical text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(t ~* '^([IVX]{1,4}\s*[-–.]|(exercise|exercice)\s*(n\s*[°o]\s*)?(\d+|[IVX]+)\M).{0,80}\(\s*\d+([.,]\d+)?\s*(points?|pts?)\s*\)$'
                  AND strpos(pg_temp.squash(canonical), pg_temp.squash(t)) = 0, false)
    FROM (SELECT trim(regexp_replace(regexp_replace(pg_temp.tail_line(x), '\\section\*?|[{}*#]', ' ', 'g'), '\s+', ' ', 'g')) AS t) s
$$;

CREATE FUNCTION pg_temp.drop_tail(x text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(left(r, length(r) - length(pg_temp.tail_line(x))), '\s+$', '')
    FROM (SELECT regexp_replace(x, '\s+$', '') AS r) s
$$;

-- The text a paper_parts value ends on: its last part, or the intro when it has none.
CREATE FUNCTION pg_temp.parts_tail_path(p jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_array_length(coalesce(p->'parts', '[]')) > 0
              THEN ARRAY['parts', (jsonb_array_length(p->'parts') - 1)::text, 'text']
              ELSE ARRAY['intro'] END
$$;

CREATE TABLE backup_next_heading_20261005 AS
SELECT id, content_latex, paper_parts
  FROM questions
 WHERE pg_temp.heading_tail(content_latex, content_text)
    OR (paper_parts IS NOT NULL
        AND pg_temp.heading_tail(paper_parts #>> pg_temp.parts_tail_path(paper_parts), content_text));

UPDATE questions q SET content_latex = pg_temp.drop_tail(q.content_latex)
  FROM backup_next_heading_20261005 b
 WHERE b.id = q.id AND pg_temp.heading_tail(q.content_latex, q.content_text);

UPDATE questions q
   SET paper_parts = jsonb_set(q.paper_parts, pg_temp.parts_tail_path(q.paper_parts),
                               to_jsonb(pg_temp.drop_tail(q.paper_parts #>> pg_temp.parts_tail_path(q.paper_parts))))
  FROM backup_next_heading_20261005 b
 WHERE b.id = q.id AND q.paper_parts IS NOT NULL
   AND pg_temp.heading_tail(q.paper_parts #>> pg_temp.parts_tail_path(q.paper_parts), q.content_text);

SELECT count(*) AS rows_cleaned FROM backup_next_heading_20261005;

COMMIT;
