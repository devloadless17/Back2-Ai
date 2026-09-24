# -*- coding: utf-8 -*-
"""Gives every chapter of a shuffled scan its own pages, in printed order.

    python scripts/corpus/taxonomy_page_order.py            all books below, dry
    python scripts/corpus/taxonomy_page_order.py --apply    write the taxonomies

WHY. taxonomy.py stores a chapter as one run of scan pages, pdfPage..pdfPageEnd,
and load-chunks.ts joins that run in scan order. Every CRDP scan in the LS
folder turned out to be shuffled within a few pages (corpus/page-audit/LS), so
each chapter held some of its neighbours' pages, lost some of its own, and its
text was stitched together out of order before being cut into chunks.

This writes `pages` — the chapter's scan pages sorted by printed page number —
into each chapter, and load-chunks.ts reads that list when it is there. The
printed number of each scan page comes from the page audit (OCR checked by eye).
A page that prints no number (a chapter opener, a full-page picture) takes the
printed number that is missing near it, or, failing that, sits just before the
printed page its position suggests.

A chapter starts at the printed page the audit settled on (the book's contents
page, or the page its heading was found on) and runs to the next chapter's
start. Where a heading starts mid-page, that page is also the previous
chapter's last page, cut at the heading, exactly as before.

The original taxonomy is copied to corpus/page-audit/backup/taxonomy/ before
the first write, and the fields this changes are kept under `beforePageOrder`.
"""

import json
import shutil
import sys
from pathlib import Path
from statistics import median

# Every other book here has a Latin title; the first Arabic one crashed the
# report on a cp1252 console before writing anything.
sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[2]
AUDIT = ROOT / "corpus" / "page-audit"
TAX = ROOT / "corpus" / "taxonomy"

# audit name -> taxonomy book
BOOKS = {
    "biology_en": "biology-en__695aa091",
    "biology_fr": "biology-fr__b41a0241",
    "chemistry_en": "chemistry-en__852933a0",
    "chimie_fr": "chimie-fr__0ddf683b",
    "math_er": "math-er__9de6de98",
    "math_fr": "math-fr__9258e8c6",
    "physics_en": "physics-en__7f314f5e",
    "physique_fr": "physique-fr__189c5fc6",
    "themes_en": "themes-gsls-en__a301fec1",
    "geo": "geographie__231a8f14",
    "french_fr": "francais-gsls-fr__881289e3",
    "themes_workbook_en": "themes-workbook-gsls-en__08c8e964",
    "falsafe_lh": "falsafa-3amma-lh__0b41b677",
    "falsafe_gsls": "falsafa-gsls__c804d5ac",
    # SE economics. Its audit came from a page-order report rather than from the
    # LS sweep, and it is the same shuffle: 63 blocks of five, every block
    # holding its own five pages in the wrong order, all 35 chapters affected.
    "ektesad": "economics-se__7979fbf6",
}

# The audits were written per track. `LS` is where the original sweep put them
# and stays the default, so no existing book changes path.
AUDIT_FOLDERS = ("LS", "SE")

# Books whose database text is a different file from the audited one: their
# own page map, scan page -> printed page, lives here instead.
PAGE_MAPS = {
    "themes_workbook_en": AUDIT / "dbmaps" / "themes-workbook-gsls-en__08c8e964.json",
    "falsafe_gsls": AUDIT / "dbmaps" / "falsafa-gsls__c804d5ac.json",
}

# Chapter starts read by eye where the audit's could not be trusted. The French
# book's headings were located on a copy missing ten pages (now restored), so
# its starts come from its contents page and its "Sous-thème" header pages. A
# theme's introduction pages go with its first sub-theme.
START_OVERRIDES = {
    "french_fr": [12, 22, 30, 38, 46, 60, 64, 78, 84, 94, 104, 114],
    # Hand-authored from "Part A" scan pages, whose `printed` field holds scan
    # numbers. Starts from the contents page; each unit opener (13, 51, 85)
    # goes with the chapter it opens.
    "themes_en": [13, 29, 40, 51, 64, 74, 85, 102, 114],
    # Contents page; unit openers (printed 11, 53, 116) go with the chapter they open.
    "themes_workbook_en": [11, 25, 39, 53, 75, 95, 116, 145, 169],
    # LH general philosophy, contents page (scan 8). Each unit opener (printed
    # 27, 123, 171, 253, 295) goes with the lesson it opens.
    "falsafe_lh": [27, 38, 52, 69, 83, 93, 102, 113, 123, 136, 148, 158, 171, 185, 199, 216,
                   228, 242, 253, 266, 274, 286, 295, 309, 320, 327, 339, 349],
    # GS/LS/SE philosophy, contents page (database scan 7). Unit openers
    # (printed 15, 69, 129) go with the lesson they open. الفعل الإنساني
    # (printed 189) was dropped from the syllabus in 2016 and is not placed.
    "falsafe_gsls": [15, 25, 37, 53, 61, 69, 83, 99, 116, 129, 140, 152, 162, 171, 181],
}

# Where the last chapter ends (first printed page NOT in it), when the old
# span's last scan is not near the book's last printed page.
END_OVERRIDES = {
    "falsafe_lh": 358,
}


def keys_for(page_map, pinned=None):
    """scan page -> sort key (its printed number, or a stand-in for unnumbered pages).

    `pinned` sets the key of an unnumbered page read by eye (front matter that
    would otherwise borrow a missing number, a unit opener, the back cover).
    """
    pinned = {int(k): v for k, v in (pinned or {}).items()}
    printed = {p["scan"]: p["printed"] for p in page_map}
    n = len(printed)
    seen = {v for v in printed.values() if v is not None}
    lo, hi = min(seen), max(seen)
    missing = set(range(lo, hi + 1)) - seen
    keys, how = {}, {}
    for s, v in printed.items():
        if v is not None:
            keys[s], how[s] = float(v), "printed"
    for s, k in pinned.items():
        keys[s], how[s] = float(k), "read by eye"
        missing.discard(k)
    for s in sorted(k for k, v in printed.items() if v is None and k not in pinned):
        near = [j - printed[j] for j in range(max(1, s - 8), min(n, s + 8) + 1) if printed.get(j) is not None]
        if not near:
            continue
        est = s - median(near)
        options = sorted((abs(m - est), m) for m in missing if abs(m - est) <= 3)
        if options:
            m = options[0][1]
            missing.discard(m)
            keys[s], how[s] = float(m), "missing number nearby"
        else:
            keys[s], how[s] = est - 0.5, "position"
    return keys, how


def audit_path(name):
    """Where this book's audit lives."""
    if name in PAGE_MAPS:
        return PAGE_MAPS[name]
    for folder in AUDIT_FOLDERS:
        path = AUDIT / folder / f"{name}.json"
        if path.exists():
            return path
    raise FileNotFoundError(f"no page audit for {name} in {'/'.join(AUDIT_FOLDERS)}")


def build(name, book, apply):
    source = audit_path(name)
    audit = json.loads(source.read_text(encoding="utf-8"))
    rel = source.relative_to(ROOT).as_posix()
    tax_path = TAX / f"{book}.json"
    tax = json.loads(tax_path.read_text(encoding="utf-8"))
    keys, how = keys_for(audit["pageMap"], audit.get("pinnedKeys"))
    starts_by_title = {c["title"]: c.get("startPrinted") for c in audit.get("database", {}).get("chapters", [])}

    chapters = [c for c in tax["chapters"] if c.get("pdfPage")]
    # Always work from the taxonomy as taxonomy.py wrote it, so a second run
    # gives the same answer as the first.
    for c in chapters:
        c.setdefault("beforePageOrder", {k: c.get(k) for k in ("pdfPage", "pdfPageEnd", "pdfOffset", "pdfEndOffset")})
    orig = [c["beforePageOrder"] for c in chapters]
    if name in START_OVERRIDES:
        starts = START_OVERRIDES[name]
        assert len(starts) == len(chapters), (name, len(starts), len(chapters))
    else:
        starts = [starts_by_title.get(c["title"]) for c in chapters]
    if any(s is None for s in starts) or starts != sorted(starts):
        print(f"  {name}: chapter starts missing or out of order, skipped: {starts}")
        return None

    # The last chapter ends where it ended before: the old end scan's printed page.
    old_end = orig[-1]["pdfPageEnd"] or orig[-1]["pdfPage"]
    end_key = (END_OVERRIDES[name] - 1 if name in END_OVERRIDES else
               max(k for s, k in keys.items() if s <= old_end and how[s] == "printed" and s >= old_end - 2))

    report = []
    for i, c in enumerate(chapters):
        lo = starts[i]
        hi = starts[i + 1] if i + 1 < len(chapters) else end_key + 1
        pages = sorted((s for s, k in keys.items() if lo - 0.5 <= k < hi - 0.5), key=lambda s: keys[s])
        nxt = orig[i + 1] if i + 1 < len(chapters) else None
        before = orig[i]
        start_page = pages[0] if pages else None
        # A heading found mid-page keeps its cut: this chapter starts there, and
        # the previous chapter ends there.
        c["pdfOffset"] = None
        if before["pdfOffset"] and name not in START_OVERRIDES and before["pdfPage"] in pages:
            start_page = before["pdfPage"]
            pages.remove(start_page)
            pages.insert(0, start_page)
            c["pdfOffset"] = before["pdfOffset"]
        end_page, end_offset = (pages[-1] if pages else None), None
        if nxt and nxt.get("pdfOffset") and name not in START_OVERRIDES:
            cut = nxt["pdfPage"]
            if cut not in pages:
                pages.append(cut)
            end_page, end_offset = cut, nxt["pdfOffset"]
        c["pages"] = pages
        c["pdfPage"], c["pdfPageEnd"], c["pdfEndOffset"] = start_page, end_page, end_offset
        c["pagesFrom"] = f"printed page numbers, {rel}"
        report.append((c["title"][:38], lo, len(pages), before["pdfPage"], before["pdfPageEnd"]))

    tax["pageOrder"] = {
        "source": rel,
        "unnumberedPages": {str(s): {"key": keys[s], "how": how[s]} for s in sorted(keys) if how[s] != "printed"},
    }
    print(f"  {name} -> {book}")
    for title, lo, n, a, b in report:
        print(f"      {title:40s} starts p.{lo:<4} {n:3d} pages   (was scans {a}-{b})")
    if apply:
        backup = AUDIT / "backup" / "taxonomy" / f"{book}.json"
        backup.parent.mkdir(parents=True, exist_ok=True)
        if not backup.exists():
            shutil.copyfile(tax_path, backup)
        tax_path.write_text(json.dumps(tax, ensure_ascii=False, indent=2), encoding="utf-8")
    return tax


def main():
    apply = "--apply" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    for name, book in BOOKS.items():
        if only and name not in only:
            continue
        build(name, book, apply)
    print("written" if apply else "dry run: nothing written (use --apply)")


if __name__ == "__main__":
    main()
