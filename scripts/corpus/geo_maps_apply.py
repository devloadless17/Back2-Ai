"""Link reviewed Arabic geography document crops to their paper's questions.

    python scripts/corpus/geo_maps_apply.py            dry run
    python scripts/corpus/geo_maps_apply.py --apply
    python scripts/corpus/geo_maps_apply.py --undo

Reads corpus/geo-maps/plan.json (geo_maps_plan.py) and the crop reviews
corpus/geo-maps/review-*.json, where every crop was looked at and kept only if
it is a document a student needs (map, graph, table, diagram, photo, document
box) — not a stray heading, answer line, header or fragment.

Each kept crop is related to every question of its paper that refers to the
documents, role paper_shared, tier HUMAN: a reviewer's decision, which
backfill-visuals.ts never deletes or rewrites. All rows carry one
evidence_run, so --undo removes exactly these.
"""
import glob, json, subprocess, sys

RUN = 'geo-maps-review-2026-09-28'

def psql(sql):
    r = subprocess.run(['docker', 'exec', '-i', 'bac2-db', 'psql', '-U', 'bac2', '-d', 'bac2', '-At', '-v', 'ON_ERROR_STOP=1'],
                       input=sql, capture_output=True, text=True, encoding='utf-8')
    if r.returncode: sys.exit(r.stderr)
    return r.stdout

if '--undo' in sys.argv:
    print(psql(f"DELETE FROM question_visuals WHERE evidence_run = '{RUN}';"))
    sys.exit()

plan = {p['id']: p for p in json.load(open('corpus/geo-maps/plan.json', encoding='utf-8'))}
reviews = [r for f in sorted(glob.glob('corpus/geo-maps/review-?.json')) for r in json.load(open(f, encoding='utf-8'))]
kept = [r for r in reviews if r.get('keep')]
pairs = [(q, r['id'], plan[r['id']]) for r in kept for q in plan[r['id']]['questions']]
print(f"reviewed {len(reviews)}, kept {len(kept)}, links {len(pairs)}, questions {len({p[0] for p in pairs})}")
if '--apply' not in sys.argv:
    sys.exit('dry run. Re-run with --apply.')

values = ',\n'.join(
    f"('{q}', '{o}', 'paper_shared', false, 'strong', 'weak', 'contextual', 'human', 'active', '{RUN}', now())"
    for q, o, _ in pairs)
print(psql(f"""INSERT INTO question_visuals (question_id, occurrence_id, role, introduced_in_stimulus,
  structural_confidence, geometric_confidence, semantic_confidence, tier, status, evidence_run, updated_at)
VALUES {values}
ON CONFLICT (question_id, occurrence_id) DO NOTHING;"""))
