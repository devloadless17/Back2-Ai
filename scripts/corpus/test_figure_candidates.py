# -*- coding: utf-8 -*-
"""Golden cases for figure_candidates — figure occurrence → geometric candidates.

    python scripts/corpus/test_figure_candidates.py

C2 only: which containers geometry allows, never which question uses the
figure. Synthetic cases build a C1-shaped paper and run it through the same
`territories` / `candidates_for` the corpus run uses. The real-paper cases read
the generated artifacts and are skipped, loudly, when those are absent.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8")

from figure_candidates import (C1_FILE, OUT_FILE, candidates_for, container_facts,  # noqa: E402
                               is_banner, territories)

FAILURES = []
H, W = 3000, 2100


def check(name, ok, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f" — {detail}"))
    if not ok:
        FAILURES.append(name)


def cont(ordinal, spans, status="EXACT", end="next-container", trailing=(), lead=()):
    seg = lambda p, a, b: {"page": p, "yStart": a, "yEnd": b}  # noqa: E731
    return {"ordinal": ordinal, "index": ordinal, "title": f"ex{ordinal}",
            "alignment": {"status": status, "probe": "body"},
            "spans": [seg(*s) for s in spans], "trailingSpans": [seg(*s) for s in trailing],
            "leadInSpans": [seg(*s) for s in lead], "endReason": end}


def fig(page, y, h, x=300, w=1200):
    return {"page": page, "pageHeight": H, "pageWidth": W, "bbox": {"x": x, "y": y, "w": w, "h": h}}


def run(containers, f, family="default"):
    paper = {"containers": containers}
    return candidates_for(f, territories(paper), container_facts(paper), family)


def summary(r):
    return r["geometricConfidence"], [(c["ordinal"], c["relation"]) for c in r["candidates"]]


# ---------------------------------------------------------------------------
print("figure wholly inside one exercise")
two = [cont(1, [(1, 200, 1400)]), cont(2, [(1, 1500, 2800)])]
r = run(two, fig(1, 600, 400))
check("unique, INSIDE exercise 1", summary(r) == ("UNIQUE_GEOMETRIC", [(1, "INSIDE")]), str(summary(r)))

print("\ntwo exercises on one page, figure in the second")
r = run(two, fig(1, 1900, 500))
check("unique, INSIDE exercise 2", summary(r) == ("UNIQUE_GEOMETRIC", [(2, "INSIDE")]), str(summary(r)))

print("\nmultiple figures inside one exercise stay separate occurrences")
rs = [run(two, fig(1, y, 150)) for y in (300, 700, 1100)]
check("three verdicts, each INSIDE exercise 1", [summary(x) for x in rs] == [("UNIQUE_GEOMETRIC", [(1, "INSIDE")])] * 3)

print("\nfigure between two exercises keeps both")
gapped = [cont(1, [(1, 200, 1000)]), cont(2, [(1, 1600, 2800)])]
r = run(gapped, fig(1, 1050, 500))
check("multiple: exercise 1 below-near, exercise 2 above-near",
      summary(r) == ("MULTIPLE_GEOMETRIC", [(1, "BELOW_NEAR"), (2, "ABOVE_NEAR")]), str(summary(r)))
check("gaps are measured on the page", r["candidates"][0]["geometricEvidence"] == {"samePage": True, "gap": 50})

print("\nfigure printed beside the heading it belongs to (gs/2011 1/math_fr.pdf shape)")
beside = [cont(4, [(3, 100, 800)]), cont(5, [(3, 854, 2694)])]
r = run(beside, fig(3, 803, 534))
check("unique, INSIDE exercise V", summary(r) == ("UNIQUE_GEOMETRIC", [(5, "INSIDE")]), str(summary(r)))
check("the straddle is recorded", r["candidates"][0]["geometricEvidence"].get("startsAboveSegmentBy") == 51)

print("\nfigure on a continuation page")
cont_pages = [cont(1, [(2, 200, 1200)]), cont(2, [(3, 1500, 2900), (4, 700, 2000)]), cont(3, [(4, 2100, 2900)])]
r = run(cont_pages, fig(4, 150, 450))
check("top of page 4 before exercise 2 resumes: CONTINUATION of exercise 2",
      summary(r) == ("UNIQUE_GEOMETRIC", [(2, "CONTINUATION_PAGE")]), str(summary(r)))
check("across the break, no y from page 3 is subtracted",
      r["candidates"][0]["geometricEvidence"]["above"] == {"samePage": False, "pagesBack": 1, "fromPageTop": 150},
      str(r["candidates"][0]["geometricEvidence"]))
r = run(cont_pages, fig(4, 900, 400))
check("inside exercise 2's page-4 segment: CONTINUATION_PAGE",
      summary(r) == ("UNIQUE_GEOMETRIC", [(2, "CONTINUATION_PAGE")]), str(summary(r)))

print("\nfigure at the foot of a page, next exercise opens the next page")
split = [cont(1, [(3, 200, 1800)]), cont(2, [(4, 150, 2000)])]
r = run(split, fig(3, 1850, 900))
check("both: exercise 1 below-near, exercise 2 above-near",
      summary(r) == ("MULTIPLE_GEOMETRIC", [(1, "BELOW_NEAR"), (2, "ABOVE_NEAR")]), str(summary(r)))
check("exercise 2 measured from the figure's page bottom and its own page top",
      r["candidates"][1]["geometricEvidence"] == {"samePage": False, "pagesAhead": 1, "toPageBottom": 250})
r = run(split, fig(3, 2300, 500))
check("500px below exercise 1 (17% of the page): distant, not near",
      summary(r)[1][0] == (1, "SAME_PAGE_DISTANT"), str(summary(r)))

print("\nfirst figure before the first exercise")
r = run([cont(1, [(1, 900, 2800)])], fig(1, 450, 350))
check("one neighbour only, outside its span: WEAK", summary(r) == ("WEAK_GEOMETRIC", [(1, "ABOVE_NEAR")]), str(summary(r)))

print("\nlast figure after the last exercise")
r = run([cont(1, [(1, 200, 1800)], end="paper-end")], fig(1, 1850, 600))
check("WEAK, below-near", summary(r) == ("WEAK_GEOMETRIC", [(1, "BELOW_NEAR")]), str(summary(r)))

print("\nfigure in marking-scheme territory")
schemed = [cont(1, [(1, 200, 2800)], end="scheme-marker", trailing=[(2, 100, 2800)])]
r = run(schemed, fig(2, 900, 600))
check("no statement candidate", summary(r) == ("NO_GEOMETRIC", []) and r["territory"] == "trailing:scheme-marker",
      str(summary(r)))

print("\nC1 confidence is carried, not flattened")
r = run([cont(1, [(1, 200, 2800)], status="STRONG")], fig(1, 900, 300))
check("STRONG container: UNIQUE, structural STRONG kept",
      summary(r) == ("UNIQUE_GEOMETRIC", [(1, "INSIDE")]) and r["candidates"][0]["structuralConfidence"] == "STRONG")
r = run([cont(1, [(1, 200, 2800)], status="AMBIGUOUS")], fig(1, 900, 300))
check("AMBIGUOUS container: never UNIQUE", r["geometricConfidence"] == "WEAK_GEOMETRIC", str(summary(r)))

print("\nArabic Geography is held back")
r = run([cont(1, [(1, 200, 2800)], status="EXACT")], fig(1, 900, 300), family="geography-ar")
check("INSIDE an EXACT container, still WEAK", summary(r) == ("WEAK_GEOMETRIC", [(1, "INSIDE")]), str(summary(r)))

print("\nan unplaced container between the neighbours is a candidate too")
holes = [cont(1, [(1, 200, 1000)]), cont(2, [], status="UNRESOLVED"), cont(3, [(1, 1700, 2800)])]
r = run(holes, fig(1, 1100, 400))
check("exercise 2 appears as UNPLACED_BETWEEN",
      [c["relation"] for c in r["candidates"]] == ["BELOW_NEAR", "UNPLACED_BETWEEN", "ABOVE_NEAR"], str(summary(r)))

print("\nC1 territory and the extraction's page split disagree")
from figure_candidates import page_split_check  # noqa: E402
f = fig(3, 900, 300)
r = run([cont(1, [(1, 200, 2800), (2, 100, 2800), (3, 100, 2800)])], f)
page_split_check(f, r, (2, 2))     # the extraction says pages 3+ are scheme
check("a UNIQUE candidate on a page filed as scheme drops to WEAK",
      r["geometricConfidence"] == "WEAK_GEOMETRIC" and r.get("pageSplitDisagrees"), str(r))
f = fig(2, 900, 300)
r = run([cont(1, [(1, 200, 2800), (2, 100, 2800)])], f)
page_split_check(f, r, (2, 2))
check("agreement leaves it UNIQUE", r["geometricConfidence"] == "UNIQUE_GEOMETRIC")

print("\nexam header banner")
check("page 1, top band, wide and short: banner", is_banner(fig(1, 300, 106, x=100, w=1855), (1, 800)))
check("same shape on page 2: not a banner", not is_banner(fig(2, 300, 106, x=100, w=1855), (1, 800)))
check("below the first exercise's start: not a banner", not is_banner(fig(1, 900, 106, x=100, w=1855), (1, 800)))

# ---------------------------------------------------------------------------
print("\nreal papers (from the generated artifact)")
if not OUT_FILE.exists() or not C1_FILE.exists():
    print("  SKIP — run position_structure.py and figure_candidates.py first")
else:
    occ = {o["occurrenceId"]: o for o in json.loads(OUT_FILE.read_text(encoding="utf-8"))["occurrences"]}

    def cands(oid):
        o = occ[oid]
        return o["geometricConfidence"], [(c["ordinal"], c["relation"]) for c in o["candidates"]]

    check("gs/2011 1/math_fr.pdf 'figure ci-dessus' → exercise V",
          cands("ea2aff93f02c/347a666434013320") == ("UNIQUE_GEOMETRIC", [(5, "INSIDE")]),
          str(cands("ea2aff93f02c/347a666434013320")))
    check("lh/2015 2/bio_fr.pdf Document 2 → exercise 2, not 3",
          cands("8741f56dac25/68856a29f3963720") == ("UNIQUE_GEOMETRIC", [(2, "INSIDE")]))
    dup = [o for o in occ.values() if o["sameContentAs"]]
    check("content duplicates are kept as separate occurrences", len(dup) > 0 and all(
        x in occ for o in dup for x in o["sameContentAs"]))
    geo = [o for o in occ.values() if o.get("family") == "geography-ar" and o["eligibility"] == "ELIGIBLE"]
    check("no Arabic Geography occurrence is UNIQUE", not any(o["geometricConfidence"] == "UNIQUE_GEOMETRIC" for o in geo))
    n_files = sum(len(list(p.iterdir())) for p in Path("corpus/text").glob("*/figures") if len(p.parent.name) == 64)
    check("one occurrence per secured crop", len(occ) == n_files, f"{len(occ)} vs {n_files}")

print()
if FAILURES:
    print(f"{len(FAILURES)} failure(s): {', '.join(FAILURES)}")
    sys.exit(1)
print("all golden cases passed")
