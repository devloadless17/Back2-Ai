# -*- coding: utf-8 -*-
"""Semantic audit of the existing question ↔ figure associations against C3.

    python scripts/corpus/audit_legacy_figures.py <associations.tsv>

The TSV is a read-only export of the questions that carry `content_images`:
    source_ref <TAB> chapter subject id <TAB> first image <TAB> image count

WHAT THE LEGACY ROWS ARE. `attach-figures.ts` rendered the WHOLE printed page
on which a question's opening words were found (`/figures/<stem>-p<N>.png`),
and a DB Question is a whole EXERCISE (title, statement and every part in one
row). So a legacy association says "exercise X's figure is on page N", nothing
finer — a wrong leaf question cannot even be expressed in it.

THE QUESTION ASKED. What do the precise crops on page N say? Each association
gets the first verdict that applies:

    CORRECT              a crop on page N is semantically owned by exercise X
    PREVIOUS_OR_NEXT     page N's owned crops belong to the exercise before/after X
    OTHER_EXERCISE       page N's owned crops belong to some other exercise
    WRONG_PAGE           X owns crops, but on other pages
    SCHEME_PAGE          page N only carries marking-scheme material
    HEADER_ONLY          page N only carries the exam header banner
    UNRESOLVED           page N's crops are not resolved by C3
    NO_CROP_ON_PAGE      page N has no secured crop (vector drawing, or none)

Nothing is written anywhere; the verdicts are printed.
"""
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[2]
OWNED = {"DIRECT_REFERENCE", "CORROBORATED", "CONTEXTUAL"}


def verdict(ordinal: int, page_recs: list, owned_elsewhere: bool) -> str:
    """The audit verdict for one legacy association, from the C3 records of the
    crops on its page."""
    if not page_recs:
        return "NO_CROP_ON_PAGE"
    owners = defaultdict(set)
    for r in page_recs:
        if r.get("semanticConfidence") in OWNED:
            for o in (r.get("semanticOwner") or {}).get("containerOrdinals", []):
                owners[o].add(r["occurrenceId"])
    if ordinal in owners:
        return "CORRECT"
    if owners:
        return "PREVIOUS_OR_NEXT" if any(abs(o - ordinal) == 1 for o in owners) else "OTHER_EXERCISE"
    if owned_elsewhere:
        return "WRONG_PAGE"
    if all(r["ownershipLevel"] == "SOLUTION_MATERIAL" for r in page_recs):
        return "SCHEME_PAGE"
    if all(r["scope"] == "non-academic" for r in page_recs):
        return "HEADER_ONLY"
    return "UNRESOLVED"


def main(tsv: str):
    exams = [e for e in json.loads((ROOT / "corpus" / "exams.json").read_text(encoding="utf-8")) if e.get("sha256")]
    rows = [l.rstrip("\n").split("\t") for l in open(tsv, encoding="utf-8") if l.strip()]
    subjects = sorted({r[1] for r in rows})
    ref_to = {}
    for e in exams:
        for order, ex in enumerate(e.get("exercises") or []):
            for sid in subjects:
                ref = hashlib.sha256(f"{sid}:{e['sha256']}:{ex.get('index')}:{order}".encode()).hexdigest()
                ref_to[ref] = (e["sha256"], order + 1, str(e["path"]).replace("\\", "/"))

    c3 = json.loads((ROOT / "corpus" / ".mapping" / "figure-ownership.json").read_text(encoding="utf-8"))
    by_page, owned_pages = defaultdict(list), defaultdict(set)
    for r in c3["occurrences"]:
        by_page[(r["pdfSha256"], r["page"])].append(r)
        if r.get("semanticConfidence") in OWNED:
            for o in (r.get("semanticOwner") or {}).get("containerOrdinals", []):
                owned_pages[(r["pdfSha256"], o)].add(r["page"])
    # Positioned means "in C1", whether or not the paper has any crop at all.
    positioned = {p["sha256"] for p in json.loads(
        (ROOT / "corpus" / ".mapping" / "positioned-structure.json").read_text(encoding="utf-8"))}

    counts, examples, narrower = Counter(), defaultdict(list), Counter()
    for ref, _sid, img, _n in rows:
        hit = ref_to.get(ref)
        m = re.search(r"-p(\d+)\.png$", img)
        if not hit or not m:
            counts["NOT_TRACEABLE (source_ref from an older extraction)"] += 1
            continue
        sha, ordinal, path = hit
        page = int(m.group(1))
        if sha not in positioned:
            counts["NO_POSITION_SOURCE"] += 1
            continue
        recs = by_page.get((sha, page), [])
        v = verdict(ordinal, recs, bool(owned_pages.get((sha, ordinal), set()) - {page}))
        counts[v] += 1
        if len(examples[v]) < 6:
            examples[v].append((path, ordinal, page, [(r["occurrenceId"][-8:], r["semanticConfidence"],
                                                       (r.get("semanticOwner") or {}).get("containerOrdinals"))
                                                      for r in recs][:4]))
        if v == "CORRECT":
            mine = [r for r in recs if ordinal in (r.get("semanticOwner") or {}).get("containerOrdinals", [])
                    and r.get("semanticConfidence") in OWNED]
            narrower["page carries only this exercise's crops" if len(mine) == len(recs)
                     else "page also carries other crops"] += 1

    print(f"legacy associations: {sum(counts.values())}")
    for k, v in counts.most_common():
        print(f"  {v:>5}  {k}")
    print("\nwhere CORRECT, what the whole page adds:")
    for k, v in narrower.most_common():
        print(f"  {v:>5}  {k}")
    for k in ("PREVIOUS_OR_NEXT", "OTHER_EXERCISE", "WRONG_PAGE", "SCHEME_PAGE", "HEADER_ONLY", "UNRESOLVED"):
        if examples[k]:
            print(f"\n{k}:")
            for e in examples[k]:
                print("  ", e)


if __name__ == "__main__":
    main(sys.argv[1])
