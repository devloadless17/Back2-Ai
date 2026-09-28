"""Write corpus/geo-maps/prod-geo-maps.sql: the reviewed geography document
links, keyed so they apply on a database whose ids differ.

    python scripts/corpus/geo_maps_prod_sql.py

The crop is found by (paper_sha256, crop_name) — the occurrence's natural key,
which exists on production once backfill-visuals has run there. The question
by source_ref, or subject + the first 300 non-space characters where it has
none. Rows whose crop or question is missing are counted, not guessed.
Undo: DELETE FROM question_visuals WHERE evidence_run = 'geo-maps-review-2026-09-28';
"""
import json, subprocess

RUN = 'geo-maps-review-2026-09-28'
r = subprocess.run(['docker', 'exec', '-i', 'bac2-db', 'psql', '-U', 'bac2', '-d', 'bac2', '-At'], input=f"""
select json_agg(json_build_object('sha', o.paper_sha256, 'crop', o.crop_name, 'ref', q.source_ref, 'track', t.code,
  'head', left(regexp_replace(q.content_text, '\s+', '', 'g'), 300)))
  from question_visuals v join visual_occurrences o on o.id = v.occurrence_id join questions q on q.id = v.question_id
  join chapters c on c.id = q.chapter_id join subjects s on s.id = c.subject_id join tracks t on t.id = s.track_id
 where v.evidence_run = '{RUN}'""", capture_output=True, text=True, encoding='utf-8', check=True)
rows = json.loads(r.stdout)
lit = lambda v: 'NULL' if v is None else "'" + str(v).replace("'", "''") + "'"
values = ',\n'.join(f"({lit(x['sha'])}, {lit(x['crop'])}, {lit(x['ref'])}, {lit(x['track'])}, {lit(x['head'])})" for x in rows)
sql = f"""-- Geography documents (maps, graphs, cartoons) linked to the questions that use them.
-- {len(rows)} links, reviewed by eye 2026-09-28. Needs backfill-visuals to have run here first.
-- Undo: DELETE FROM question_visuals WHERE evidence_run = '{RUN}';
\set ON_ERROR_STOP 1
BEGIN;
CREATE TEMP TABLE want (sha text, crop text, ref text, track text, head text);
INSERT INTO want VALUES
{values};
CREATE TEMP TABLE hit AS
SELECT DISTINCT o.id AS occurrence_id, q.id AS question_id
  FROM want w
  JOIN visual_occurrences o ON o.paper_sha256 = w.sha AND o.crop_name = w.crop
  JOIN tracks t ON t.code = w.track
  JOIN subjects s ON s.track_id = t.id AND s.name = 'جغرافيا'
  JOIN chapters c ON c.subject_id = s.id
  JOIN questions q ON q.chapter_id = c.id
   AND (q.source_ref = w.ref OR left(regexp_replace(q.content_text, '\s+', '', 'g'), 300) = w.head);
SELECT (SELECT count(*) FROM want) AS wanted, count(*) AS matched FROM hit;
INSERT INTO question_visuals (question_id, occurrence_id, role, introduced_in_stimulus, structural_confidence,
  geometric_confidence, semantic_confidence, tier, status, evidence_run, updated_at)
SELECT question_id, occurrence_id, 'paper_shared', false, 'strong', 'weak', 'contextual', 'human', 'active', '{RUN}', now()
  FROM hit ON CONFLICT (question_id, occurrence_id) DO NOTHING;
COMMIT;
"""
open('corpus/geo-maps/prod-geo-maps.sql', 'w', encoding='utf-8').write(sql)
print(f'{len(rows)} links -> corpus/geo-maps/prod-geo-maps.sql')
