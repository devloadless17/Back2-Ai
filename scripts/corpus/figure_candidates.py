# -*- coding: utf-8 -*-
"""Which positioned containers are geometrically plausible owners of each figure?

    python scripts/corpus/figure_candidates.py            # → corpus/.mapping/figure-candidates.json
    python scripts/corpus/figure_candidates.py --show <pdf sha256 prefix>

C2 of three layers. C1 (`position_structure.py`) says where each exercise was
printed. This says, from geometry alone, which of those exercises a figure
could belong to. It does NOT say which question uses the figure: captions,
"Document 2", "la figure ci-dessus" are C3's evidence, and are deliberately not
read here, so that geometry stays an independent signal C3 can be checked
against.

Nothing here writes to the database or to `contentImages`.

GEOMETRY PRODUCES CANDIDATES, NOT OWNERS. A figure inside an exercise's span is
a candidate for it. A figure outside every span is not thereby unrelated:
gs/2011 1/math_fr.pdf prints a figure beside the "V-" heading and the statement
says "Dans la figure ci-dessus". So a figure in the gap between two exercises
keeps both neighbours as candidates, and geometry says so rather than picking.

PAGE-LOCAL. Every y compared here belongs to the same page. Across a page break
the only relation used is reading order — which territory comes last before
this page, which first after it — never a subtraction of y values from two
different pages.

C1 CONFIDENCE IS CARRIED, NOT FLATTENED. Each candidate keeps the C1 status of
the container it came from (`structuralConfidence`). The C2 verdict
(`geometricConfidence`) is a separate field with its own vocabulary, and can
never be UNIQUE on top of a container C1 only called AMBIGUOUS.
"""
import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[2]
TEXT = ROOT / "corpus" / "text"
META = ROOT / "corpus" / "meta"
C1_FILE = ROOT / "corpus" / ".mapping" / "positioned-structure.json"
OUT_FILE = ROOT / "corpus" / ".mapping" / "figure-candidates.json"

_URL = re.compile(r"https://cdn\.mathpix\.com/cropped/[^)\s\"'}]+")

# A figure belongs to a territory when at least this share of its height lies
# inside it. Below that it sits in the gap between territories.
MAJORITY = 0.5
# A gap to the neighbouring territory counts as near up to this share of the
# page height; beyond it the neighbour is SAME_PAGE_DISTANT. Set from the
# measured gap distribution, not from coverage — see figure-candidates notes.
NEAR_FRACTION = 0.10

# The exam header banner: page 1, above the first exercise, in the top band of
# the page, nearly full width and short. Measured on SV_Chim_2024_1_En.pdf,
# whose crop is "مسابقة في مادة الكيمياء / الاسم / الرقم / المدة". Nothing
# looser: a thin wide crop elsewhere can be a number line or a table header.
BANNER_TOP = 0.20
BANNER_MIN_WIDTH = 0.60
BANNER_MAX_HEIGHT = 0.07

UNIQUE_RELATIONS = {"INSIDE", "CONTINUATION_PAGE", "LEAD_IN"}
TRUSTED = {"EXACT", "STRONG"}


# --------------------------------------------------------------------------
# Figure occurrences
# --------------------------------------------------------------------------
def crop_name(url: str) -> list:
    """The local file names `fetch-mathpix-figures.ts` may have given this URL.

    It hashed the URL as Markdown stored it, with `\\&` escapes; lines.json
    holds it unescaped. Both are tried.
    """
    out = []
    for form in (url.replace("&", "\\&"), url):
        out.append(hashlib.sha256(form.encode()).hexdigest()[:16])
    return out


def occurrences_for(sha: str) -> list:
    """Every secured crop of one PDF, in reading order, with its page and box."""
    fdir = TEXT / sha / "figures"
    if not fdir.is_dir():
        return []
    files = {f.split(".")[0]: f for f in sorted(os.listdir(fdir))}
    if not files:
        return []
    data = json.loads((META / sha / "lines.json").read_text(encoding="utf-8"))
    out, seen, order = [], set(), 0
    for pg in data.get("pages", []):
        for li, ln in enumerate(pg.get("lines", [])):
            for url in _URL.findall(str(ln.get("text") or "")):
                name = next((n for n in crop_name(url) if n in files), None)
                if name is None or name in seen:
                    continue
                seen.add(name)
                q = {k: int(float(v[0])) for k, v in parse_qs(urlparse(url.replace("\\&", "&")).query).items()}
                path = fdir / files[name]
                out.append({
                    "crop": f"corpus/text/{sha}/figures/{files[name]}",
                    "contentHash": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "page": pg["page"],
                    "pageHeight": pg.get("page_height"),
                    "pageWidth": pg.get("page_width"),
                    "bbox": {"x": q.get("top_left_x"), "y": q.get("top_left_y"),
                             "w": q.get("width"), "h": q.get("height")},
                    "order": order,
                    "lineIndexOnPage": li,
                })
                order += 1
    missing = set(files) - seen
    for name in sorted(missing):     # a crop whose URL is no longer in lines.json
        out.append({"crop": f"corpus/text/{sha}/figures/{files[name]}", "page": None, "order": order,
                    "bbox": None, "contentHash": hashlib.sha256((fdir / files[name]).read_bytes()).hexdigest()})
        order += 1
    return out


# --------------------------------------------------------------------------
# Territory
# --------------------------------------------------------------------------
def territories(paper: dict) -> list:
    """Every positioned segment of the paper, tagged, in reading order.

    kind: statement | leadIn | trailing. A trailing segment carries the reason
    its owner's statement ended there (scheme-marker, paper-header,
    unclaimed-heading).
    """
    segs = []
    for c in paper["containers"]:
        first_page = c["spans"][0]["page"] if c["spans"] else None
        for s in c["spans"]:
            segs.append({"page": s["page"], "y0": s["yStart"], "y1": s["yEnd"], "kind": "statement",
                         "ordinal": c["ordinal"], "continuation": s["page"] != first_page})
        for s in c.get("leadInSpans") or []:
            segs.append({"page": s["page"], "y0": s["yStart"], "y1": s["yEnd"], "kind": "leadIn",
                         "ordinal": c["ordinal"], "continuation": False})
        for s in c.get("trailingSpans") or []:
            segs.append({"page": s["page"], "y0": s["yStart"], "y1": s["yEnd"], "kind": "trailing",
                         "ordinal": c["ordinal"], "reason": c.get("endReason"), "continuation": False})
    segs.sort(key=lambda s: (s["page"], s["y0"], s["y1"], s["ordinal"], s["kind"]))
    return segs


def overlap(fig: dict, seg: dict) -> float:
    y0, y1 = fig["bbox"]["y"], fig["bbox"]["y"] + fig["bbox"]["h"]
    return max(0, min(y1, seg["y1"]) - max(y0, seg["y0"])) / max(1, y1 - y0)


def is_banner(fig: dict, first_anchor: tuple) -> bool:
    b, H, W = fig["bbox"], fig.get("pageHeight"), fig.get("pageWidth")
    if fig["page"] != 1 or not H or not W:
        return False
    if first_anchor is not None and (fig["page"], b["y"] + b["h"]) > first_anchor:
        return False
    return (b["y"] <= BANNER_TOP * H and b["w"] >= BANNER_MIN_WIDTH * W and b["h"] <= BANNER_MAX_HEIGHT * H)


# --------------------------------------------------------------------------
# Candidates
# --------------------------------------------------------------------------
def container_facts(paper: dict) -> dict:
    out = {}
    for c in paper["containers"]:
        a = c["alignment"]
        out[c["ordinal"]] = {
            "ordinal": c["ordinal"], "index": c.get("index"), "title": c.get("title") or "",
            "structuralConfidence": a["status"], "structuralProbe": a.get("probe"),
            "placed": bool(c["spans"]),
        }
    return out


def candidates_for(fig: dict, segs: list, facts: dict, family: str) -> dict:
    page = fig["page"]
    b = fig["bbox"]
    H = fig.get("pageHeight") or 1
    near = NEAR_FRACTION * H
    fy0, fy1 = b["y"], b["y"] + b["h"]
    center = (fy0 + fy1) / 2
    on_page = [s for s in segs if s["page"] == page]
    cands, evidence, territory = {}, [], None

    def add(ordinal, relation, **geo):
        f = facts[ordinal]
        key = ordinal
        if key in cands:           # keep the stronger relation for a container seen twice
            if relation in UNIQUE_RELATIONS and cands[key]["relation"] not in UNIQUE_RELATIONS:
                cands[key].update({"relation": relation, "geometricEvidence": geo})
            return
        cands[key] = {
            "ordinal": ordinal, "index": f["index"], "title": f["title"][:80],
            "relation": relation, "structuralConfidence": f["structuralConfidence"],
            "structuralProbe": f["structuralProbe"], "geometricEvidence": geo,
        }

    def unplaced_between(lo, hi):
        """Containers C1 could not place whose ordinal lies between two neighbours."""
        for o in sorted(facts):
            if lo < o < hi and not facts[o]["placed"]:
                add(o, "UNPLACED_BETWEEN", between=[lo, hi])

    best = max(on_page, key=lambda s: (overlap(fig, s), -s["y0"]), default=None)
    share = overlap(fig, best) if best else 0.0

    if best is not None and share >= MAJORITY:
        geo = {"overlapShare": round(share, 3), "segment": [best["y0"], best["y1"]]}
        if best["kind"] == "statement":
            territory = "statement"
            if fy0 < best["y0"]:
                # gs/2011 1/math_fr.pdf: the "ci-dessus" figure is printed beside
                # the "V-" heading and starts 51px above it. Still majority-inside;
                # the straddle is recorded for C3, not used to decide.
                geo["startsAboveSegmentBy"] = best["y0"] - fy0
            add(best["ordinal"], "CONTINUATION_PAGE" if best["continuation"] else "INSIDE", **geo)
        elif best["kind"] == "leadIn":
            territory = "leadIn"
            add(best["ordinal"], "LEAD_IN", **geo)
        else:
            territory = f"trailing:{best['reason']}"
            evidence.append(f"{share:.0%} of the figure lies in the territory after container "
                            f"{best['ordinal']} ended ({best['reason']}) — not statement territory")
            if best["reason"] == "unclaimed-heading":
                nxt = min((s["ordinal"] for s in segs if s["kind"] == "statement"
                           and s["ordinal"] > best["ordinal"]), default=max(facts) + 1)
                unplaced_between(best["ordinal"], nxt)
                if not cands:
                    # ls/2007 1/bio_fr.pdf: the extraction produced one container,
                    # and "Question II" onwards belongs to none. Reported, not guessed.
                    evidence.append("no canonical container exists for the exercise printed here "
                                    "(the extraction did not produce it)")
    else:
        territory = "gap"
        before = [s for s in segs if (s["page"], s["y1"]) <= (page, center) and
                  (s["page"] < page or s["y1"] <= center)]
        after = [s for s in segs if (s["page"] > page) or (s["page"] == page and s["y0"] >= center)]
        above = max(before, key=lambda s: (s["page"], s["y1"]), default=None)
        below = min(after, key=lambda s: (s["page"], s["y0"]), default=None)

        def gap_above(s):
            if s["page"] == page:
                return {"samePage": True, "gap": fy0 - s["y1"]}
            return {"samePage": False, "pagesBack": page - s["page"], "fromPageTop": fy0}

        def gap_below(s):
            if s["page"] == page:
                return {"samePage": True, "gap": s["y0"] - fy1}
            return {"samePage": False, "pagesAhead": s["page"] - page, "toPageBottom": H - fy1}

        def is_near(g):
            if g["samePage"]:
                return g["gap"] <= near
            return g.get("fromPageTop", g.get("toPageBottom", 1e9)) <= near and \
                g.get("pagesBack", g.get("pagesAhead")) == 1

        if above and below and above["kind"] == "statement" and below["kind"] == "statement" \
                and above["ordinal"] == below["ordinal"]:
            # Between two stretches of the same exercise, e.g. across a page break.
            add(above["ordinal"], "CONTINUATION_PAGE" if not gap_above(above)["samePage"] else "INSIDE",
                above=gap_above(above), below=gap_below(below))
        else:
            if above is not None:
                g = gap_above(above)
                if above["kind"] in ("statement", "leadIn"):
                    rel = "BELOW_NEAR" if is_near(g) else "SAME_PAGE_DISTANT" if g["samePage"] else "DISTANT"
                    add(above["ordinal"], rel, **g)
                else:
                    evidence.append(f"above it: territory after container {above['ordinal']} ({above['reason']})")
            if below is not None:
                g = gap_below(below)
                if below["kind"] in ("statement", "leadIn"):
                    if below["continuation"]:
                        rel = "CONTINUATION_PAGE"
                    else:
                        rel = "ABOVE_NEAR" if is_near(g) else "SAME_PAGE_DISTANT" if g["samePage"] else "DISTANT"
                    add(below["ordinal"], rel, **g)
                else:
                    evidence.append(f"below it: territory after container {below['ordinal']} ({below['reason']})")
            lo = above["ordinal"] if above and above["kind"] != "trailing" else (above["ordinal"] if above else 0)
            hi = below["ordinal"] if below else max(facts) + 1
            if above is None or below is None or lo < hi:
                unplaced_between(lo if above else 0, hi)
            if above is None:
                evidence.append("before every positioned territory of the paper")
            if below is None:
                evidence.append("after every positioned territory of the paper")

    cand_list = [cands[k] for k in sorted(cands)]
    trusted = [c for c in cand_list if c["structuralConfidence"] in TRUSTED]

    if not cand_list:
        verdict = "NO_GEOMETRIC"
    elif len(cand_list) > 1:
        verdict = "MULTIPLE_GEOMETRIC"
    elif cand_list[0]["relation"] in UNIQUE_RELATIONS and trusted and family != "geography-ar":
        verdict = "UNIQUE_GEOMETRIC"
    else:
        verdict = "WEAK_GEOMETRIC"
    if family == "geography-ar" and cand_list:
        evidence.append("Arabic Geography: C1 positions are not trusted enough to promote geometry — held at "
                        "WEAK/MULTIPLE until C3 corroborates")
    if cand_list and not trusted:
        evidence.append("every candidate rests on AMBIGUOUS or UNRESOLVED C1 structure")
    return {"territory": territory, "candidates": cand_list, "geometricConfidence": verdict,
            "allCandidatesUntrusted": bool(cand_list) and not trusted, "evidence": evidence}


def family_of(papers: list, language: str) -> str:
    name = papers[0].split("/")[-1].lower()
    if language == "ar" and re.search(r"geo", name):
        return "geography-ar"
    return "default"


# --------------------------------------------------------------------------
# Corpus run
# --------------------------------------------------------------------------
def page_split_check(fig: dict, r: dict, split: tuple | None) -> None:
    """Second opinion from the canonical extraction's own statement/scheme page split.

    exams.json records how many pages are statement (`paperPages`) and how
    many scheme. It is independent of C1's territory, and where both exist
    they agree on 97% of crops. Where they disagree neither is reliably right:
    lh/2013 2/math_en.pdf page 3 is a scheme C1 did not recognise, while
    ls/2017 1/bio_fr.pdf page 4 is statement text the page split misfiles. So
    a disagreement never decides anything; it only stops a candidate from
    being UNIQUE.
    """
    if not split:
        return
    paper_pages, scheme_pages = split
    if not paper_pages or not scheme_pages:
        return
    on_scheme_page = fig["page"] > paper_pages
    in_statement = r["territory"] in ("statement", "leadIn", "gap") and bool(r["candidates"])
    if on_scheme_page and in_statement:
        r["evidence"].append(f"the canonical extraction files page {fig['page']} under the marking scheme "
                             f"(statement pages: {paper_pages}) while C1 territory says statement — "
                             f"they disagree, so geometry is not UNIQUE")
        r["pageSplitDisagrees"] = True
        if r["geometricConfidence"] == "UNIQUE_GEOMETRIC":
            r["geometricConfidence"] = "WEAK_GEOMETRIC"
    elif not on_scheme_page and str(r["territory"]).startswith("trailing"):
        r["evidence"].append(f"the canonical extraction files page {fig['page']} under the statement "
                             f"(statement pages: {paper_pages}) while C1 says it is past the statement")
        r["pageSplitDisagrees"] = True


def build(c1: list) -> dict:
    splits = {}
    for e in json.loads((ROOT / "corpus" / "exams.json").read_text(encoding="utf-8")):
        if e.get("sha256"):
            splits.setdefault(e["sha256"], (e.get("paperPages"), e.get("schemePages")))
    by_sha = {}
    for p in sorted(c1, key=lambda p: p["paper"]):
        by_sha.setdefault(p["sha256"], []).append(p)
    shas = sorted(d for d in os.listdir(TEXT) if re.fullmatch(r"[0-9a-f]{64}", d)
                  and (TEXT / d / "figures").is_dir() and os.listdir(TEXT / d / "figures"))
    occs = []
    for sha in shas:
        figs = occurrences_for(sha)
        rows = by_sha.get(sha)
        if not rows:
            doc = {}
            try:
                doc = json.loads((META / sha / "document.json").read_text(encoding="utf-8"))
            except Exception:
                pass
            for f in figs:
                f.update({"pdfSha256": sha, "papers": [], "sourceFile": doc.get("file"),
                          "eligibility": "NO_POSITION_SOURCE", "geometricConfidence": None,
                          "candidates": [], "territory": None,
                          "evidence": ["this PDF has no positioned structure (not in the canonical extraction)"]})
                occs.append(f)
            continue
        paper = rows[0]           # rows sharing a PDF are positioned identically
        papers = [r["paper"] for r in rows]
        family = family_of(papers, paper.get("language"))
        segs = territories(paper)
        facts = container_facts(paper)
        first_anchor = min(((s["page"], s["y0"]) for s in segs if s["kind"] == "statement"), default=None)
        for f in figs:
            f.update({"pdfSha256": sha, "papers": papers, "family": family})
            if f["page"] is None:
                f.update({"eligibility": "NO_POSITION_SOURCE", "geometricConfidence": None, "candidates": [],
                          "territory": None, "evidence": ["crop URL not found in the positioned lines"]})
            elif is_banner(f, first_anchor):
                f.update({"eligibility": "NON_ACADEMIC_CANDIDATE", "geometricConfidence": None,
                          "candidates": [], "territory": "header-band",
                          "evidence": ["page 1, above the first exercise, top band, ≥60% page width and "
                                       "≤7% page height: the exam header banner"]})
            else:
                r = candidates_for(f, segs, facts, family)
                untrusted = r.pop("allCandidatesUntrusted")
                no_trusted_structure = not any(v["structuralConfidence"] in TRUSTED for v in facts.values())
                if untrusted or (not r["candidates"] and no_trusted_structure):
                    elig = "POSITION_UNCERTAIN"
                else:
                    elig = "ELIGIBLE"
                page_split_check(f, r, splits.get(sha))
                f.update(r)
                f["eligibility"] = elig
            occs.append(f)

    # Content duplicates stay separate occurrences; they are only cross-referenced.
    by_hash = {}
    for o in occs:
        o["occurrenceId"] = f"{o['pdfSha256'][:12]}/{o['crop'].split('/')[-1].split('.')[0]}"
        by_hash.setdefault(o["contentHash"], []).append(o["occurrenceId"])
    for o in occs:
        same = [x for x in by_hash[o["contentHash"]] if x != o["occurrenceId"]]
        o["sameContentAs"] = sorted(same)
        for c in o.get("candidates") or []:
            c["containerId"] = f"{o['pdfSha256'][:12]}#{c['ordinal']}"
    occs.sort(key=lambda o: (o["pdfSha256"], o["order"]))
    c1_hash = hashlib.sha256(C1_FILE.read_bytes()).hexdigest()
    return {"inputs": {"positionedStructureSha256": c1_hash,
                       "rules": {"MAJORITY": MAJORITY, "NEAR_FRACTION": NEAR_FRACTION,
                                 "BANNER_TOP": BANNER_TOP, "BANNER_MIN_WIDTH": BANNER_MIN_WIDTH,
                                 "BANNER_MAX_HEIGHT": BANNER_MAX_HEIGHT}},
            "occurrences": occs}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT_FILE))
    ap.add_argument("--show", default=None, help="print the occurrences of one PDF (sha256 prefix)")
    args = ap.parse_args()
    c1 = json.loads(C1_FILE.read_text(encoding="utf-8"))
    result = build(c1)
    if args.show:
        for o in result["occurrences"]:
            if o["pdfSha256"].startswith(args.show):
                print(json.dumps(o, ensure_ascii=False, indent=1))
        return
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    Path(args.out).write_text(text, encoding="utf-8")
    occs = result["occurrences"]
    from collections import Counter
    el = Counter(o["eligibility"] for o in occs)
    gc = Counter(o["geometricConfidence"] for o in occs if o["eligibility"] == "ELIGIBLE")
    print(f"figure occurrences : {len(occs)}")
    for k in ("ELIGIBLE", "POSITION_UNCERTAIN", "NO_POSITION_SOURCE", "NON_ACADEMIC_CANDIDATE"):
        print(f"  {k:<24}{el[k]:>6}")
    print("eligible:")
    for k in ("UNIQUE_GEOMETRIC", "MULTIPLE_GEOMETRIC", "WEAK_GEOMETRIC", "NO_GEOMETRIC"):
        print(f"  {k:<24}{gc[k]:>6}")
    print(f"artifact : {Path(args.out).relative_to(ROOT) if Path(args.out).is_relative_to(ROOT) else args.out}")
    print(f"sha256   : {hashlib.sha256(text.encode('utf-8')).hexdigest()}")


if __name__ == "__main__":
    main()
