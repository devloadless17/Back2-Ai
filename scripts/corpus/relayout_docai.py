# -*- coding: utf-8 -*-
"""Rebuilds Document AI pages in column order, from the paragraph positions.

    python scripts/corpus/relayout_docai.py <book> <raw json folder>          dry run, report
    python scripts/corpus/relayout_docai.py <book> <raw json folder> --apply  rewrite page-NNN.md
    python scripts/corpus/relayout_docai.py <book> <raw json folder> --show 80

WHY. import_docai.py took each page's text in Document AI's own reading
order, which on these books runs straight across the page: on a two-column
geography page a sentence of the lesson continues into a newspaper quote in
the side box, line after line. The words are right; the passages are not.
Every block Document AI returns carries its bounding box, so the order can be
rebuilt without reading the page again.

HOW. A recursive XY-cut: split the page at the widest empty horizontal band
(top to bottom), or failing that at the widest empty vertical band (columns,
right to left for Arabic, left to right otherwise), and recurse. Blocks that
cannot be separated keep Document AI's order.

WHAT IS DROPPED. Only blocks that are figure debris by construction: more
than a third of their letters in a script the book does not use (CJK,
Devanagari, symbols), or no letter at all and under four characters. Every
dropped block is listed in the report. Nothing else is removed: the rebuilt
page must hold exactly the old page's tokens minus the dropped ones, and a
page where that does not hold is left untouched.

A page is also left untouched when its current text is not Document AI's
(transcribed by hand, or blanked as a duplicate), so this never undoes a
correction. The original pages are backed up once under
corpus/page-audit/backup/relayout/<book>/.
"""

import json
import re
import shutil
import sys
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEXT = ROOT / "corpus" / "text"
BACKUP = ROOT / "corpus" / "page-audit" / "backup" / "relayout"
REPORT = ROOT / "corpus" / "page-audit" / "relayout"

MIN_GAP = 0.012  # a cut needs an empty band at least this wide (fraction of the page)


def order_key(path):
    m = re.search(r"\((\d+)\)", path.name)
    return (1, int(m.group(1))) if m else (0, 0)


def anchor_text(doc_text, layout):
    segs = (layout or {}).get("textAnchor", {}).get("textSegments", [])
    return "".join(doc_text[int(s.get("startIndex", 0)):int(s.get("endIndex", 0))] for s in segs)


def box(layout):
    v = layout.get("boundingPoly", {}).get("normalizedVertices") or []
    if not v:
        return None
    xs = [p.get("x", 0) for p in v]
    ys = [p.get("y", 0) for p in v]
    return min(xs), min(ys), max(xs), max(ys)


def foreign_share(text, rtl):
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    def ok(c):
        if "؀" <= c <= "ۿ" or "ݐ" <= c <= "ݿ" or "ﭐ" <= c <= "ﻼ":
            return True
        name = unicodedata.name(c, "")
        return name.startswith("LATIN") or name.startswith("GREEK")
    return sum(1 for c in letters if not ok(c)) / len(letters)


def is_debris(text, rtl):
    t = text.strip()
    if not t:
        return True
    if foreign_share(t, rtl) > 0.34:
        return True
    if not any(c.isalpha() or c.isdigit() for c in t) and len(t) < 4:
        return True
    return False


def xy_cut(items, rtl, depth=0):
    """items: list of (box, idx). Returns a list of leaves (lists of idx) in
    reading order, each paired with the gap that preceded it.

    At every level the WIDEST empty band wins, horizontal or vertical. Word
    boxes on one printed line are separated by line spacing (~0.5% of the
    page) while two columns are separated by a gutter several times wider, so
    columns are cut apart before lines are, and a line of the left column is
    never glued to the matching line of the right one."""
    if len(items) <= 1:
        return [(0.0, [i for _, i in items])]

    def gaps(axis):
        lo, hi = (1, 3) if axis == "y" else (0, 2)
        spans = sorted((b[lo], b[hi]) for b, _ in items)
        out, reach = [], spans[0][1]
        for a, z in spans[1:]:
            if a - reach > 0:
                out.append((a - reach, (reach + a) / 2))
            reach = max(reach, z)
        return out

    best = None
    for axis in ("x", "y"):
        for width, at in gaps(axis):
            need = MIN_GAP if axis == "x" else 0.004
            if width >= need and (best is None or width > best[0]):
                best = (width, at, axis)
    if best is None:
        return [(0.0, [i for _, i in items])]
    width, at, axis = best
    lo = 1 if axis == "y" else 0
    first = [(b, i) for b, i in items if (b[lo] + b[lo + 2]) / 2 < at]
    second = [(b, i) for b, i in items if (b[lo] + b[lo + 2]) / 2 >= at]
    if not first or not second:
        return [(0.0, [i for _, i in items])]
    if axis == "x" and rtl:
        first, second = second, first
    left = xy_cut(first, rtl, depth + 1)
    right = xy_cut(second, rtl, depth + 1)
    # A column change or a wide vertical space is a paragraph break.
    sep = 1.0 if axis == "x" or width > 0.012 else 0.0
    return left + [(sep, right[0][1])] + right[1:]


def tokens(text):
    """Characters, ignoring spacing: reordering may change where spaces fall
    (punctuation is its own token), never which characters are there."""
    return Counter(c for c in text if not c.isspace())


def rebuild(page, doc_text, rtl):
    words = []
    for t in page.get("tokens") or []:
        s = anchor_text(doc_text, t.get("layout"))
        bb = box(t.get("layout") or {})
        if s.strip() and bb:
            # Keep the token's own trailing space (or none, before punctuation).
            words.append((bb, s.replace(chr(10), " ")))
    if not words:
        return None, []
    leaves = xy_cut([(bb, i) for i, (bb, _) in enumerate(words)], rtl)
    out, dropped, line = [], [], []

    def flush(sep):
        if not line:
            return
        text = "".join(line).strip()
        if is_debris(text, rtl):
            dropped.append(text)
        else:
            if out and sep:
                out.append("")
            out.append(text)
        line.clear()

    for sep, leaf in leaves:
        # A leaf is one line fragment; keep the reader's word order inside it.
        flush(sep)
        line.extend(words[i][1] for i in sorted(leaf))
    flush(0)
    return chr(10).join(out), dropped


def main():
    book, folder = sys.argv[1], Path(sys.argv[2])
    apply = "--apply" in sys.argv
    show = int(sys.argv[sys.argv.index("--show") + 1]) if "--show" in sys.argv else None
    files = sorted(folder.glob("*.json"), key=order_key)
    raw = []
    for f in files:
        d = json.loads(f.read_text(encoding="utf-8"))
        for pg in d.get("pages") or []:
            raw.append((d.get("text") or "", pg))
    tdir = TEXT / book
    n_db = len(list(tdir.glob("page-*.md")))
    if len(raw) != n_db:
        sys.exit(f"{book}: {len(raw)} Document AI pages but {n_db} text pages; not aligned")

    sample = "".join(anchor_text(t, pg.get("layout")) for t, pg in raw[:30])
    rtl = sum(1 for c in sample if "؀" <= c <= "ۿ") > sum(1 for c in sample if c.isascii() and c.isalpha())

    report = {"book": book, "rtl": rtl, "changed": [], "skipped": [], "dropped": {}}
    if apply:
        b = BACKUP / book
        if not b.exists():
            b.mkdir(parents=True)
            for p in tdir.glob("page-*.md"):
                shutil.copyfile(p, b / p.name)
    for i, (doc_text, pg) in enumerate(raw, start=1):
        path = tdir / f"page-{i:03d}.md"
        current = path.read_text(encoding="utf-8")
        original = anchor_text(doc_text, pg.get("layout")).strip()
        if current.strip() != original:
            report["skipped"].append({"page": i, "why": "text is not Document AI's (hand-corrected or blanked)"})
            continue
        new, dropped = rebuild(pg, doc_text, rtl)
        if new is None:
            report["skipped"].append({"page": i, "why": "no word positions"})
            continue
        if tokens(new) + sum((tokens(t) for t in dropped), Counter()) != tokens(original):
            report["skipped"].append({"page": i, "why": "rebuilt page would not hold the same words"})
            continue
        if show == i:
            print(new)
            print("\n--- dropped ---\n" + "\n".join(dropped))
        if new.strip() != original:
            report["changed"].append(i)
            if dropped:
                report["dropped"][str(i)] = dropped
            if apply:
                path.write_text(new, encoding="utf-8")
    REPORT.mkdir(parents=True, exist_ok=True)
    (REPORT / f"{book}.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{book}: {len(raw)} pages, {len(report['changed'])} reordered, "
          f"{sum(len(v) for v in report['dropped'].values())} debris blocks dropped on "
          f"{len(report['dropped'])} pages, {len(report['skipped'])} left alone"
          + ("" if apply else "  (dry run)"))


if __name__ == "__main__":
    main()
