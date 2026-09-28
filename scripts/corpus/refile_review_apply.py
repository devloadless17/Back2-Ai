"""Apply the chapter decisions in corpus/refile-review/decisions/.

    python scripts/corpus/refile_review_apply.py            dry run, per subject
    python scripts/corpus/refile_review_apply.py --apply    write, in one transaction
    python scripts/corpus/refile_review_apply.py --undo <receipt.json>

Only `high`/`medium` decisions with no flag move a question. A question whose
chapter changed since its packet was exported is skipped, not overwritten.
Moves the question's chapter_id AND its home question_chapters row, and
replaces its other same-subject links (the old embedding guesses from
link-chapters / link-parts) with the reviewer's `also` list. Run
`npm run corpus:share-tracks -- --undo` then `npm run corpus:share-tracks`
afterwards, so the links shared into other tracks follow the new home.
"""
import json, pathlib, subprocess, sys, datetime, collections

ROOT = pathlib.Path('corpus/refile-review')
APPLY = '--apply' in sys.argv

def psql(q, json_out=False):
    r = subprocess.run(['docker', 'exec', '-i', 'bac2-db', 'psql', '-U', 'bac2', '-d', 'bac2', '-At', '-v', 'ON_ERROR_STOP=1'],
                       input=q, capture_output=True, text=True, encoding='utf-8')
    if r.returncode:
        sys.exit(r.stderr)
    return json.loads(r.stdout.strip() or 'null') if json_out else r.stdout

def lit(s):
    return "'" + str(s).replace("'", "''") + "'"

if '--undo' in sys.argv:
    rec = json.loads(pathlib.Path(sys.argv[sys.argv.index('--undo') + 1]).read_text(encoding='utf-8'))
    moves = rec['moves']
    stmts = ['BEGIN;']
    for l in rec['new_links']:
        stmts.append(f"DELETE FROM question_chapters WHERE question_id = {lit(l['q'])} AND chapter_id = {lit(l['c'])};")
    for m in moves:
        stmts.append(f"UPDATE questions SET chapter_id = {lit(m['from_id'])} WHERE id = {lit(m['id'])} AND chapter_id = {lit(m['to_id'])};")
        stmts.append(f"DELETE FROM question_chapters WHERE question_id = {lit(m['id'])} AND chapter_id = {lit(m['to_id'])};")
        stmts.append(f"INSERT INTO question_chapters (question_id, chapter_id) VALUES ({lit(m['id'])}, {lit(m['from_id'])}) ON CONFLICT DO NOTHING;")
    for l in rec['old_links']:
        score = 'NULL' if l['s'] is None else l['s']
        stmts.append(f"INSERT INTO question_chapters (question_id, chapter_id, score) VALUES ({lit(l['q'])}, {lit(l['c'])}, {score}) ON CONFLICT DO NOTHING;")
    stmts.append('COMMIT;')
    psql('\n'.join(stmts))
    print(f'undid {len(moves)} moves')
    sys.exit()

ids = []
plan = []
secondary = {}  # question id -> (subject_id, [also chapter ids], home chapter id)
report = collections.OrderedDict()
for dfile in sorted((ROOT / 'decisions').glob('*.json')):
    packet = json.loads((ROOT / 'packets' / dfile.name).read_text(encoding='utf-8'))
    decisions = json.loads(dfile.read_text(encoding='utf-8'))
    chap = {c['n']: c for c in packet['chapters']}
    cur = {q['id']: q['current_chapter'] for q in packet['questions']}
    r = report.setdefault(dfile.stem, collections.Counter())
    r['questions'] = len(cur)
    missing = set(cur) - {d['id'] for d in decisions}
    r['no decision'] = len(missing)
    for d in decisions:
        if d['id'] not in cur:
            r['unknown id'] += 1; continue
        if d.get('flag'):
            r['flag ' + d['flag']] += 1; continue
        if d['chapter'] not in chap:
            r['bad chapter number'] += 1; continue
        # A civics exercise mixes topics on purpose (a document question, then
        # "strike the intruder" on elections): a medium call there is a coin toss.
        allowed = ('high',) if 'تربية_وطنية' in dfile.stem else ('high', 'medium')
        if d.get('confidence') not in allowed:
            r['low, left alone'] += 1; continue
        home = chap[d['chapter']]['id']
        also = [chap[a]['id'] for a in (d.get('also') or []) if a in chap and chap[a]['id'] != home]
        secondary[d['id']] = (packet['subject_id'], sorted(set(also)), home)
        r['also links'] += len(set(also))
        if d['chapter'] == cur[d['id']]:
            r['kept'] += 1; continue
        r['move'] += 1
        plan.append({'id': d['id'], 'subject': dfile.stem,
                     'from_id': chap[cur[d['id']]]['id'], 'from': chap[cur[d['id']]]['name'],
                     'to_id': chap[d['chapter']]['id'], 'to': chap[d['chapter']]['name'],
                     'confidence': d['confidence'], 'why': d.get('why')})

for name, r in report.items():
    print(f"{name:32} " + '  '.join(f'{k}={v}' for k, v in r.items() if v))
print(f'\n{len(plan)} moves planned')

if not plan and not secondary:
    sys.exit()

# Skip anything that moved since the packet was exported.
live = psql("select json_object_agg(id, chapter_id) from questions where id in (" +
            ','.join(lit(m['id']) for m in plan) + ")", json_out=True) if plan else {}
stale = [m for m in plan if live.get(m['id']) != m['from_id']]
plan = [m for m in plan if live.get(m['id']) == m['from_id']]
for m in stale:
    secondary.pop(m['id'], None)
if stale:
    print(f'{len(stale)} skipped: chapter changed since export')

if not APPLY:
    print('dry run. Re-run with --apply.')
    sys.exit()

# Same-subject non-home links as they stand, for the receipt.
old_links = psql("""select json_agg(json_build_object('q', qc.question_id, 'c', qc.chapter_id, 's', qc.score))
  from question_chapters qc join questions q on q.id = qc.question_id
  join chapters h on h.id = q.chapter_id join chapters t on t.id = qc.chapter_id
 where h.subject_id = t.subject_id and qc.chapter_id <> q.chapter_id""", json_out=True) or []
# Never the new home: a question moving onto a chapter it was already linked to keeps that row.
old_links = [l for l in old_links if l['q'] in secondary and l['c'] != secondary[l['q']][2]]
print(f'{len(old_links)} old same-subject links replaced by {sum(len(v[1]) for v in secondary.values())} reviewed ones')

stamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
receipt = ROOT / f'receipt-{stamp}.json'
receipt.write_text(json.dumps({'moves': plan, 'old_links': old_links,
    'new_links': [{'q': q, 'c': c} for q, v in secondary.items() for c in v[1]]}, ensure_ascii=False, indent=1), encoding='utf-8')
stmts = ['BEGIN;']
for m in plan:
    stmts.append(f"UPDATE questions SET chapter_id = {lit(m['to_id'])} WHERE id = {lit(m['id'])} AND chapter_id = {lit(m['from_id'])};")
    stmts.append(f"DELETE FROM question_chapters WHERE question_id = {lit(m['id'])} AND chapter_id = {lit(m['from_id'])};")
    stmts.append(f"INSERT INTO question_chapters (question_id, chapter_id) VALUES ({lit(m['id'])}, {lit(m['to_id'])}) ON CONFLICT DO NOTHING;")
stmts.append('COMMIT;')
psql('\n'.join(stmts))
print(f'moved {len(plan)}. receipt: {receipt}')
