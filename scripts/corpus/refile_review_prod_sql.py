"""Write corpus/refile-review/prod-replay.sql: the local refile review, keyed so
it can run on a database whose question ids differ.

    python scripts/corpus/refile_review_prod_sql.py

A question is found by source_ref, or, where it has none, by subject plus the
first 300 non-space characters of its text. A chapter is found by track code,
subject name and chapter name. The SQL backs up every row it touches into
backup_refile_review_<stamp>, runs in one transaction, and prints the counts.
"""
import json, glob, pathlib, subprocess, datetime

ROOT = pathlib.Path('corpus/refile-review')

def psql(q):
    r = subprocess.run(['docker', 'exec', '-i', 'bac2-db', 'psql', '-U', 'bac2', '-d', 'bac2', '-At'],
                       input=q, capture_output=True, text=True, encoding='utf-8', check=True)
    return json.loads(r.stdout.strip() or 'null')

moved = set()
for f in glob.glob(str(ROOT / 'receipt-*.json')):
    moved |= {m['id'] for m in json.loads(pathlib.Path(f).read_text(encoding='utf-8'))['moves']}
rejected = set(json.loads((ROOT / 'rejected-not-a-question.json').read_text()))
for f in glob.glob(str(ROOT / 'rejected-answer-keys-*.json')):
    rejected |= set(json.loads(pathlib.Path(f).read_text()))
rejected |= {l.strip() for l in (ROOT / 'rejected-philosophy-marking-schemes.txt').read_text(encoding='utf-8').splitlines()
             if len(l.strip()) == 36}
rejected.add('d9afde84-c6bc-42f6-a697-304b14e3d492')
also = {}
for f in glob.glob(str(ROOT / 'decisions' / '*.json')):
    for d in json.loads(pathlib.Path(f).read_text(encoding='utf-8')):
        if d.get('also') and d['id'] in moved:
            also[d['id']] = d['also']

ids = sorted(moved | rejected)
rows = psql("""select json_agg(json_build_object('id', q.id, 'ref', q.source_ref,
  'head', left(regexp_replace(q.content_text, '\s+', '', 'g'), 300), 'track', t.code, 'subject', s.name,
  'chapter', c.name, 'status', q.verified_status,
  'also', (select json_agg(c2.name) from question_chapters qc join chapters c2 on c2.id = qc.chapter_id
            where qc.question_id = q.id and c2.subject_id = c.subject_id and c2.id <> c.id)))
  from questions q join chapters c on c.id = q.chapter_id join subjects s on s.id = c.subject_id
  join tracks t on t.id = s.track_id where q.id in (""" + ','.join(f"'{i}'" for i in ids) + ')')

def lit(v):
    return 'NULL' if v is None else "'" + str(v).replace("'", "''") + "'"

stamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
values = ',\n'.join(
    f"({lit(r['ref'])}, {lit(r['head'])}, {lit(r['track'])}, {lit(r['subject'])}, {lit(r['chapter'])}, "
    f"{'true' if r['id'] in rejected else 'false'}, {'true' if r['id'] in moved else 'false'}, "
    f"ARRAY[{','.join(lit(a) for a in (r['also'] or []))}]::text[])"
    for r in rows)
sql = f"""-- Refile review replay, generated {stamp} from the local database.
-- {len(rows)} questions: {len(moved)} re-filed, {len(rejected)} rejected (answer keys, marking schemes).
-- Undo: UPDATE questions q SET chapter_id = b.chapter_id, verified_status = b.verified_status
--         FROM backup_refile_review_{stamp} b WHERE b.id = q.id;
--       then restore question_chapters from backup_refile_review_links_{stamp}.
\set ON_ERROR_STOP 1
BEGIN;
CREATE TEMP TABLE want (ref text, head text, track text, subject text, chapter text, reject bool, refile bool, also text[]);
INSERT INTO want VALUES
{values};

-- Match each wanted row to a live question and its target chapter.
CREATE TEMP TABLE hit AS
SELECT DISTINCT ON (q.id) q.id, w.reject, w.refile, w.also, tc.id AS to_chapter, s.id AS subject_id
  FROM want w
  JOIN tracks t ON t.code = w.track
  JOIN subjects s ON s.track_id = t.id AND s.name = w.subject
  JOIN chapters tc ON tc.subject_id = s.id AND tc.name = w.chapter
  JOIN chapters qc ON qc.subject_id = s.id
  JOIN questions q ON q.chapter_id = qc.id
   AND (q.source_ref = w.ref OR (w.ref IS NULL AND q.source_ref IS NULL
        AND left(regexp_replace(q.content_text, '\s+', '', 'g'), 300) = w.head));

SELECT count(*) AS wanted FROM want;
SELECT count(*) AS matched, count(*) FILTER (WHERE refile) AS to_refile, count(*) FILTER (WHERE reject) AS to_reject FROM hit;

CREATE TABLE backup_refile_review_{stamp} AS
  SELECT q.id, q.chapter_id, q.verified_status FROM questions q JOIN hit ON hit.id = q.id;
CREATE TABLE backup_refile_review_links_{stamp} AS
  SELECT qc.* FROM question_chapters qc JOIN hit ON hit.id = qc.question_id;

UPDATE questions q SET verified_status = 'rejected'
  FROM hit WHERE hit.id = q.id AND hit.reject AND q.verified_status = 'unverified';

-- Re-file: new home chapter, and same-subject links = the reviewer's "also".
UPDATE questions q SET chapter_id = hit.to_chapter FROM hit WHERE hit.id = q.id AND hit.refile;
DELETE FROM question_chapters qc USING hit, chapters c
 WHERE hit.refile AND qc.question_id = hit.id AND c.id = qc.chapter_id AND c.subject_id = hit.subject_id;
INSERT INTO question_chapters (question_id, chapter_id)
  SELECT hit.id, hit.to_chapter FROM hit WHERE hit.refile ON CONFLICT DO NOTHING;
INSERT INTO question_chapters (question_id, chapter_id)
  SELECT hit.id, c.id FROM hit CROSS JOIN LATERAL unnest(hit.also) AS a(name)
    JOIN chapters c ON c.subject_id = hit.subject_id AND c.name = a.name
   WHERE hit.refile ON CONFLICT DO NOTHING;
COMMIT;
"""
(ROOT / 'prod-replay.sql').write_text(sql, encoding='utf-8')
print(f'{len(rows)} rows ({len(moved)} moved, {len(rejected)} rejected) -> {ROOT / "prod-replay.sql"}')
