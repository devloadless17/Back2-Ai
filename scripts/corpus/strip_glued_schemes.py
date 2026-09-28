"""Philosophy rows that carry the official marking scheme.

    python scripts/corpus/strip_glued_schemes.py [--apply]

corpus/refile-review/glued-plan.json lists, from a read of every philosophy row
using marking-guide wording ("المقدمة: (علامتان)", "السؤال التصحيح العلامة",
"تترك حرية الإجابة للمرشح"): `reject` — the whole row is scheme text; `cut` —
the question comes first and the scheme is glued after it, so the text is cut
where the scheme's heading starts. Backup table first; embeddings of cut rows
cleared (run `npm run ingest -- --embed-missing`).
"""
import json, re, subprocess, sys, datetime

APPLY = '--apply' in sys.argv
plan = json.load(open('corpus/refile-review/glued-plan.json'))
# The 2018 paper's scheme opens with its own title page right after the last
# question line, before the heading the general rule looks for.
CUT_BEFORE = {'01b032f0': '\nهادة الفلسفة العربية'}

def psql(sql):
    r = subprocess.run(['docker', 'exec', '-i', 'bac2-db', 'psql', '-U', 'bac2', '-d', 'bac2', '-At', '-v', 'ON_ERROR_STOP=1'],
                       input=sql, capture_output=True, text=True, encoding='utf-8')
    if r.returncode: sys.exit(r.stderr)
    return r.stdout

lit = lambda s: "'" + s.replace("'", "''") + "'"
rows = json.loads(psql("select json_agg(json_build_object('id', id, 't', content_text, 'lx', content_latex)) from questions where id in ("
                       + ','.join(lit(c['id']) for c in plan['cut']) + ")"))
cuts = []
for q in rows:
    c = next(c for c in plan['cut'] if c['id'] == q['id'])
    marker = CUT_BEFORE.get(q['id'][:8])
    at = q['t'].find(marker) if marker else c['at']
    text = q['t'][:at].rstrip()
    lx = q['lx']
    if lx:  # same cut in the display text: at the same heading, found afresh
        tail = q['t'][at:at + 40].strip()[:15]
        j = lx.find(tail) if tail else -1
        lx = lx[:j].rstrip() if j > 0 else None
    cuts.append((q['id'], text, lx))
    print('cut', q['id'][:8], len(q['t']), '->', len(text), '| ends:', re.sub(r'\s+', ' ', text[-80:]))
print(f"reject {len(plan['reject'])}")
if not APPLY:
    sys.exit('dry run. Re-run with --apply.')

stamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
ids = plan['reject'] + [c[0] for c in cuts]
stmts = ['BEGIN;',
         f"CREATE TABLE backup_glued_schemes_{stamp} AS SELECT id, content_text, content_latex, verified_status FROM questions WHERE id IN ({','.join(map(lit, ids))});",
         f"UPDATE questions SET verified_status = 'rejected' WHERE verified_status = 'unverified' AND id IN ({','.join(map(lit, plan['reject']))});"]
for qid, text, lx in cuts:
    stmts.append(f"UPDATE questions SET content_text = {lit(text)}, content_latex = {lit(lx) if lx else 'NULL'}, embedding = NULL WHERE id = {lit(qid)};")
stmts.append('COMMIT;')
psql('\n'.join(stmts))
print(f'done. backup: backup_glued_schemes_{stamp}')
