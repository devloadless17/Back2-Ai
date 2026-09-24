# -*- coding: utf-8 -*-
"""Finds scan pages that are out of order, misplaced, duplicated or missing, and
checks what that did to the book's chapters in the database.

    python scripts/corpus/audit_book_pages.py            all books in BOOKS
    python scripts/corpus/audit_book_pages.py physics_en one book

Reads corpus/page-audit/marks/<sha8>.json (from read_page_marks.py), any hand
readings in corpus/page-audit/manual/<sha8>.json, corpus/page-audit/db-chunks.json
(an export of content_chunks with their chapters) and the book's
corpus/taxonomy/<book>.json. Writes corpus/page-audit/LS/<name>.json.

WHY THIS MATTERS. taxonomy.py places every chapter at "printed page + one
offset" and runs it to the next chapter's start. That is right only if the scan
is in printed order. Where pages are shuffled, a chapter's span holds some
pages of its neighbours and loses some of its own, and every chunk cut from
those pages is filed under the wrong chapter.

HOW A PAGE NUMBER IS CHOSEN. OCR of a footer returns every number on it:
figure labels, table values, unit numbers. A candidate is kept when it is a
bare 1-3 digit token in the header or footer band, and it is chosen when
nearby scan pages carry numbers at a similar offset (the book mostly runs in
order even where it is shuffled). A number far from its neighbours is kept
only if both OCR passes read it, confidently, in the book's usual number
position — that is what a page bound into the wrong place looks like, and it
must not be thrown away as noise. Where a book prints even numbers on one side
and odd on the other, a reading on the wrong side is rejected.
"""

import difflib
import os
import json
import re
import sys
from bisect import bisect_left
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
AUDIT = ROOT / "corpus" / "page-audit"
LS = ROOT / "corpus" / "crdp ebooks" / "LS"

# name -> (files in the LS folder, sha8, database book, how the two relate)
BOOKS = {
    "biology_en": (["EN/biology_en.pdf"], "695aa091", "biology-en__695aa091", "same file"),
    "chemistry_en": (["EN/chemistry_en.pdf"], "852933a0", "chemistry-en__852933a0", "same file"),
    "math_er": (["EN/math_er.pdf"], "9de6de98", "math-er__9de6de98", "same file"),
    "physics_en": (["EN/physics_en.pdf"], "7f314f5e", "physics-en__7f314f5e", "same file"),
    "themes_en": (["EN/themes_en.pdf"], "a301fec1", "themes-gsls-en__a301fec1", "same file"),
    "themes_workbook_en": (["EN/themes_workbook_en.pdf"], "bed1be44", "themes-workbook-gsls-en__08c8e964", "different file"),
    "biology_fr": (["FR/biology_fr.pdf"], "b41a0241", "biology-fr__b41a0241", "same file"),
    "chimie_fr": (["FR/chimie_fr.pdf"], "0ddf683b", "chimie-fr__0ddf683b", "same file"),
    "math_fr": (["FR/math_fr.pdf"], "9258e8c6", "math-fr__9258e8c6", "same file"),
    "physique_fr": (["FR/physique_fr.pdf"], "189c5fc6", "physique-fr__189c5fc6", "same file"),
    "french_fr": (["FR/french_fr.pdf"], "540cb70e", "francais-gsls-fr__881289e3", "different file"),
    "geo": (["EN/geo.pdf", "FR/geo.pdf"], "35ae6c00", "geographie__231a8f14", "different file"),
    "arabe": (["EN/arabe.pdf", "FR/arabe.pdf"], "e20f814d", "arabic-lit-gsls-se__58bea168", "different source"),
    "falsafe": (["EN/falsafe.pdf", "FR/falsafe.pdf"], "f164213e", "falsafa-gsls__c804d5ac", "different source"),
    "tarbeya": (["EN/tarbeya.pdf", "FR/tarbeya.pdf"], "7faa6beb", "tarbiya__164689a6", "different source"),
    # Added to LS/EN on 2026-09-24. Its cover says الآداب والإنسانيات: this is
    # the LH general-philosophy book, not the GS/LS/SE one.
    "falsafe_lh": (["EN/لفلسفة العامة.pdf"], "99531baf", "falsafa-3amma-lh__0b41b677", "different file"),
    # GS only: the two-volume GS maths course. Every other GS book is the same
    # file as its LS counterpart above (GS = LS minus biology, plus these).
    "math_gs_1_en": (["../GS/En/math_gs_1_en.pdf"], "289de41e",
                     "289de41e5b683087171d2d02f8ac52ba323d0ef1b4e44d977ab7060817b4c38b", "same file", "GS"),
    "math_gs_2_en": (["../GS/En/math_gs_2_en.pdf"], "56566975", "math-gs-2-en__56566975", "same file", "GS"),
    "math_gs_1_fr": (["../GS/FR/math_gs_1_fr.pdf"], "184c4281", "math-gs-1-fr__184c4281", "same file", "GS"),
    "math_gs_2_fr": (["../GS/FR/math_gs_2_fr.pdf"], "57a12d5b", "math-gs-2-fr__57a12d5b", "same file", "GS"),
}

BOTTOM_BAND = 0.87   # a footer number starts below this
TOP_BAND = 0.085     # a header number ends above this
WINDOW = 12          # scan pages either side that vote on a reading
TOLERANCE = 6        # how far a neighbour's offset may differ and still agree
FAR = 15             # a page this many scans from its place is "misplaced", not "out of order"

ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


# ---------------------------------------------------------------- page numbers

def candidates(entry):
    """Every plausible page-number token on one scan page, merged across passes."""
    found = {}
    for key in ("bottom", "bottom_inv", "top", "top_inv"):
        for d in entry.get(key, []):
            zone = "bottom" if key.startswith("bottom") else "top"
            if zone == "bottom" and d["y0"] < BOTTOM_BAND:
                continue
            if zone == "top" and d["y1"] > TOP_BAND:
                continue
            text = d["text"].translate(ARABIC_DIGITS).strip()
            bare = re.sub(r"[\s.\-_|·•'\"()\[\]]", "", text)
            strong = bool(re.fullmatch(r"\d{1,3}", bare))
            value = int(bare) if strong else None
            if not strong and len(text) <= 40:
                m = re.fullmatch(r"(\d{1,3})\s*[^\d\s].*|.*[^\d\s.,]\s*(\d{1,3})", text)
                if m:
                    value = int(m.group(1) or m.group(2))
            if not value:
                continue
            # Some books print the number in an oval that clips its first
            # digit, so page 118 reads "18". A two-digit reading far behind
            # its scan position is given its hundreds back when that lands
            # near the scan position; a page truly bound 40+ pages early
            # would not also land there. Marked so the sheet shows it.
            restored = False
            if value < 100 and entry["page"] - value > 40:
                for h in (100, 200, 300):
                    if abs(entry["page"] - (value + h)) <= 15:
                        value, restored = value + h, True
                        break
            c = found.setdefault((value, zone), {
                "value": value, "zone": zone, "strong": strong, "passes": set(), "restored": restored,
                "conf": 0.0, "x": (d["x0"] + d["x1"]) / 2, "y": d["y0"]})
            c["strong"] = c["strong"] or strong
            c["passes"].add("inv" if key.endswith("_inv") else "col")
            c["conf"] = max(c["conf"], d["conf"])
    return list(found.values())


def choose_numbers(pages, manual):
    """scan page -> (printed number or None, how it was decided, alternatives)."""
    cands = {e["page"]: candidates(e) for e in pages}
    n = len(pages)

    def support(scan, value):
        off = value - scan
        votes = 0
        for j in range(max(1, scan - WINDOW), min(n, scan + WINDOW) + 1):
            # A neighbour carrying the SAME number is not support: that is a
            # unit number or a label repeated on every page ("UNIT 1"), not a
            # page count running alongside this one.
            if j != scan and any(abs((c["value"] - j) - off) <= TOLERANCE and c["value"] != value
                                 for c in cands.get(j, [])):
                votes += 1
        return votes

    chosen = {}
    for scan in range(1, n + 1):
        # A restored reading is a guess about a clipped digit: it loses to any
        # reading taken as printed that its neighbours also support.
        ranked = sorted(cands[scan], key=lambda c: (support(scan, c["value"]) >= 2, not c["restored"],
                                                     support(scan, c["value"]), c["strong"],
                                                     len(c["passes"]), c["conf"]), reverse=True)
        chosen[scan] = [(c, support(scan, c["value"])) for c in ranked]

    # The book's usual number position, learned from well-supported readings.
    settled = [cs[0][0] for cs in chosen.values() if cs and cs[0][1] >= 3 and cs[0][0]["strong"]]
    zone = Counter(c["zone"] for c in settled).most_common(1)[0][0] if settled else "bottom"
    ys = sorted(c["y"] for c in settled if c["zone"] == zone) or [0.94]
    y_lo, y_hi = ys[len(ys) // 20] - 0.015, ys[-1 - len(ys) // 20] + 0.015

    # Even/odd sides: learned the same way, used only if the book is consistent.
    side = lambda c: "L" if c["x"] < 0.4 else ("R" if c["x"] > 0.6 else "C")
    pairs = Counter((c["value"] % 2, side(c)) for c in settled if side(c) != "C")
    parity_side = {}
    for parity in (0, 1):
        l, r = pairs[(parity, "L")], pairs[(parity, "R")]
        if l + r >= 20 and max(l, r) / (l + r) >= 0.9:
            parity_side[parity] = "L" if l > r else "R"
    if len(set(parity_side.values())) < 2:
        parity_side = {}

    result = {}
    for scan, ranked in chosen.items():
        if str(scan) in manual:
            v = manual[str(scan)]
            result[scan] = (v if isinstance(v, int) else None, "manual", [])
            continue
        alts = [c["value"] for c, _ in ranked]
        pick = None
        for c, sup in ranked:
            if parity_side and side(c) in ("L", "R") and parity_side.get(c["value"] % 2) != side(c):
                continue
            if sup >= 2:
                pick = (c["value"], "ocr-leading-digit-restored" if c.get("restored") else "ocr")
            elif (c["strong"] and len(c["passes"]) == 2 and c["conf"] >= 0.9
                  and c["zone"] == zone and y_lo <= c["y"] <= y_hi):
                pick = (c["value"], "ocr-isolated")
            if pick:
                break
        result[scan] = (pick[0], pick[1], alts) if pick else (None, "unread", alts)
    return result, {"zone": zone, "band": [round(y_lo, 3), round(y_hi, 3)],
                    "evenOddSides": {("even" if k == 0 else "odd"): v for k, v in parity_side.items()}}


def longest_increasing(seq):
    """Indices of one longest strictly increasing subsequence of (scan, printed) pairs."""
    tails, tails_idx, prev = [], [], [None] * len(seq)
    for i, (_, v) in enumerate(seq):
        k = bisect_left(tails, v)
        if k == len(tails):
            tails.append(v)
            tails_idx.append(i)
        else:
            tails[k] = v
            tails_idx[k] = i
        prev[i] = tails_idx[k - 1] if k else None
    out, i = [], tails_idx[-1] if tails_idx else None
    while i is not None:
        out.append(i)
        i = prev[i]
    return set(reversed(out))


# ---------------------------------------------------------------- page text

def page_text(book, scan):
    p = ROOT / "corpus" / "text" / book / f"page-{scan:03d}.md"
    if not p.exists():
        return None
    t = p.read_text(encoding="utf-8")
    t = re.sub(r"!\[\]\([^)]*\)|\\includegraphics\[[^\]]*\]\{[^}]*\}|https?://\S+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def fold(s):
    s = s.lower()
    s = re.sub(r"[ً-ْٰـ]", "", s)
    s = s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ى", "ي").replace("ة", "ه")
    import unicodedata
    s = "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch))
    return re.sub(r"[^\w]+", " ", s).strip()


def similar(a, b):
    if not a or not b:
        return None
    return round(difflib.SequenceMatcher(None, a[:3000], b[:3000], autojunk=False).ratio(), 3)


# ---------------------------------------------------------------- audit

def folder_of(name):
    """Which track folder a book's report goes in (LS unless it says otherwise)."""
    return BOOKS[name][4] if len(BOOKS[name]) > 4 else "LS"


def audit(name):
    files, sha8, db_book, relation = BOOKS[name][:4]
    marks_path = AUDIT / "marks" / f"{sha8}.json"
    marks = json.loads(marks_path.read_text(encoding="utf-8"))
    manual_path = AUDIT / "manual" / f"{sha8}.json"
    manual = json.loads(manual_path.read_text(encoding="utf-8")) if manual_path.exists() else {}
    pages = marks["pages"]
    n = len(pages)
    same_scan = relation == "same file" or manual.get("_sameScanAsDb")
    text_book = db_book if same_scan else None

    numbers, layout = choose_numbers(pages, {k: v for k, v in manual.items() if not k.startswith("_")})
    read = [(s, v) for s, (v, how, _) in sorted(numbers.items()) if v is not None]
    by_printed = defaultdict(list)
    for s, v in read:
        by_printed[v].append(s)

    # Duplicates: one printed number on two or more scans.
    duplicates = []
    for v, scans in sorted(by_printed.items()):
        if len(scans) > 1:
            sims = None
            if text_book:
                sims = [similar(page_text(text_book, scans[0]), page_text(text_book, s)) for s in scans[1:]]
            kind = ("same page scanned twice" if sims and all(x is not None and x >= 0.8 for x in sims)
                    else "different content, same number (one reading is probably wrong)" if sims
                    else "unverified")
            duplicates.append({"printedPage": v, "scanPages": scans, "textSimilarity": sims, "verdict": kind})

    # Order: the longest run that increases is taken as "in place".
    dedup = []
    seen = set()
    for s, v in read:
        if v in seen:
            continue
        seen.add(v)
        dedup.append((s, v))
    keep = longest_increasing(dedup)
    in_place = [dedup[i] for i in sorted(keep)]
    in_place_printed = [v for _, v in in_place]
    moved = []
    for i, (s, v) in enumerate(dedup):
        if i in keep:
            continue
        k = bisect_left(in_place_printed, v)
        after = in_place[k - 1] if k else None
        target = after[0] + 1 if after else 1
        distance = s - target
        moved.append({
            "scanPage": s, "printedPage": v,
            "shouldFollowPrinted": after[1] if after else None,
            "shouldFollowScan": after[0] if after else None,
            "scansAway": distance,
            "kind": "misplaced" if abs(distance) > FAR else "out of order",
        })
    # Consecutive moved scans that stay consecutive in print are one block.
    blocks = []
    for m in moved:
        if blocks and m["scanPage"] == blocks[-1][-1]["scanPage"] + 1:
            blocks[-1].append(m)
        else:
            blocks.append([m])
    moved_blocks = [{"scanPages": [b[0]["scanPage"], b[-1]["scanPage"]],
                     "printedPages": [x["printedPage"] for x in b],
                     "kind": "misplaced" if any(x["kind"] == "misplaced" for x in b) else "out of order"}
                    for b in blocks]

    # Missing: numbers inside the printed range that no scan carries.
    unread = [s for s, (v, how, _) in sorted(numbers.items()) if v is None]
    lo = in_place_printed[0] if in_place_printed else None
    hi = in_place_printed[-1] if in_place_printed else None
    missing, unaccounted = [], []
    if lo is not None:
        for v in range(lo, hi + 1):
            if v in by_printed:
                continue
            # Six scans, not two: in a shuffled book the pages printed either side
            # of a unit opener can sit several scans away from it.
            near = sorted({u for u in unread for w in (v - 2, v - 1, v + 1, v + 2)
                           for s in by_printed.get(w, []) if abs(u - s) <= 6})
            (missing if not near else unaccounted).append(
                {"printedPage": v, "unreadScansNearby": near} if near else v)

    # ------------------------------------------------ against the database
    # Where the database's copy is the same scan but a block of it differs,
    # the hand-made map says which printed page each database scan page holds.
    db_numbers = dict(numbers)
    for k, v in manual.get("_dbScanPrinted", {}).items():
        db_numbers[int(k)] = (v if isinstance(v, int) else None, "database copy", [])
    db = compare_db(name, db_book, relation, same_scan, db_numbers, n, pages_printed=by_printed)

    report = {
        "book": name,
        "files": files,
        "sha8": sha8,
        "scanPages": n,
        "databaseBook": db_book,
        "relationToDatabase": relation if not manual.get("_sameScanAsDb") else "different file, same scan order",
        "pageNumbers": {
            "printedRange": [lo, hi],
            "read": len(read), "unread": len(unread),
            "position": layout,
            "note": "unread = no page number found; covers, dividers and full-page pictures often have none",
        },
        "summary": {
            "outOfOrderPages": sum(1 for m in moved if m["kind"] == "out of order"),
            "misplacedPages": sum(1 for m in moved if m["kind"] == "misplaced"),
            "duplicatedPrintedPages": len(duplicates),
            "largestDistanceFromPlaceInScans": max((abs(m["scansAway"]) for m in moved), default=0),
            "missingPrintedPages": len(missing),
            "numbersOnlyPossiblyOnUnreadPages": len(unaccounted),
        },
        "outOfOrder": [m for m in moved if m["kind"] == "out of order"],
        "misplaced": [m for m in moved if m["kind"] == "misplaced"],
        "movedBlocks": moved_blocks,
        "duplicates": duplicates,
        "missingPrintedPages": missing,
        "numbersPossiblyOnUnreadPages": unaccounted,
        "unreadScanPages": unread,
        "correctOrder": restored_order(numbers, n),
        "pageMap": [{"scan": s, "printed": v, "how": how} for s, (v, how, _) in sorted(numbers.items())],
        "database": db,
    }
    # Findings made by hand (reading a contents page by eye, comparing with a
    # database built from another source) live beside the script's output.
    notes_path = AUDIT / "notes" / f"{name}.json"
    if notes_path.exists():
        notes = json.loads(notes_path.read_text(encoding="utf-8"))
        report["database"]["indexComparison"] = notes
        for m in notes.get("misplacedByHand", []):
            # Found by eye: in numeric order but bound in the wrong place.
            report["misplaced"].append(m)
            report["summary"]["misplacedPages"] += 1
        if "missingPages" in notes:
            # A file holding only the cover has no page numbers to find gaps
            # between, so "0 missing" would be false.
            report["summary"]["missingPrintedPages"] = notes["missingPages"]
            report["missingPrintedPages"] = notes["missingPages"]
    out = AUDIT / folder_of(name) / f"{name}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return report


def restored_order(numbers, n):
    """Scan pages sorted into printed order. A page with no number stays behind
    the scan page it follows now, which is right for chapter openers and
    full-page figures and has to be checked by eye for anything else."""
    groups, current = [], None
    for s in range(1, n + 1):
        v = numbers[s][0]
        if v is not None or current is None:
            current = [v if v is not None else -1, s, []]
            groups.append(current)
        else:
            current[2].append(s)
    groups.sort(key=lambda g: (g[0], g[1]))
    order = []
    for _, s, tail in groups:
        order.append(s)
        order.extend(tail)
    return order


def compare_db(name, db_book, relation, same_scan, numbers, n, pages_printed):
    tax_path = ROOT / "corpus" / "taxonomy" / f"{db_book}.json"
    tax = json.loads(tax_path.read_text(encoding="utf-8")) if tax_path.exists() else None
    chunks = [c for c in json.loads((AUDIT / "db-chunks.json").read_text(encoding="utf-8"))
              if c["book_key"] == db_book]
    out = {
        "databaseBook": db_book,
        "pageCountInDatabase": chunks[0]["page_count"] if chunks else None,
        "chunksInDatabase": len(chunks),
    }
    if not chunks:
        out["note"] = "the database holds no text from this book"
    if tax is None:
        out["note"] = (out.get("note", "") + "; no taxonomy file").strip("; ")
        return out

    toc = [c for c in tax["chapters"]]
    out["pageOffsetUsed"] = tax.get("pageOffset")
    out["chaptersInIndex"] = len(toc)

    db_names = Counter()
    for c in chunks:
        for ch in c["chapters"]:
            db_names[ch["chapter"]] += 1
    toc_titles = [c["title"] for c in toc]
    out["chaptersInDatabaseNotInIndex"] = sorted(set(db_names) - set(toc_titles))
    out["indexChaptersWithNoDatabaseText"] = [t for t in toc_titles if t not in db_names] if chunks else []

    if not same_scan:
        out["pageLevelComparison"] = ("not done: the database was built from a different file, so its "
                                      "scan page numbers do not line up with this one")
        return out

    # True chapter of each scan page, from its printed number and the index.
    # A chapter the index gives no number for was placed by finding its
    # heading in the text; that scan page is where it really starts, so its
    # printed number (or the next readable one, counted back) is the start.
    def printed_at(scan):
        for k in range(0, 4):
            if scan + k <= n and numbers[scan + k][0] is not None:
                return numbers[scan + k][0] - k
        return None

    # The truth here must not come from the page lists being judged, so the
    # heading page is the one taxonomy.py found (kept under beforePageOrder),
    # and the two books whose starts were read off their contents page by eye
    # use those readings.
    from taxonomy_page_order import START_OVERRIDES
    overrides = START_OVERRIDES.get(name)
    placed = [c for c in toc if (c.get("beforePageOrder") or {}).get("pdfPage") or c.get("pdfPage")]
    for i, c in enumerate(toc):
        heading_page = (c.get("beforePageOrder") or {}).get("pdfPage") or c.get("pdfPage")
        if overrides and c in placed:
            c["startPrinted"], c["startFrom"] = overrides[placed.index(c)], "contents page, read by eye"
        elif c.get("printed") is None and heading_page:
            c["startPrinted"], c["startFrom"] = printed_at(heading_page), "heading found in text"
        else:
            c["startPrinted"], c["startFrom"] = c.get("printed"), "index"
    starts = sorted((c["startPrinted"], c["title"]) for c in toc if c["startPrinted"] is not None)

    def chapter_of_printed(v):
        k = bisect_left([s for s, _ in starts], v + 1) - 1
        return starts[k][1] if k >= 0 else None

    first_start = starts[0][0] if starts else None
    true_chapter = {}
    for s in range(1, n + 1):
        v = numbers[s][0]
        if v is not None and first_start is not None and v >= first_start:
            true_chapter[s] = re.sub(r"\s*\(\s*\*\s*\)\s*$", "", chapter_of_printed(v) or "").strip() or None
    # An unread page takes its neighbours' chapter when they agree.
    for s in range(1, n + 1):
        if s in true_chapter or numbers[s][0] is not None:
            continue
        before = next((true_chapter[j] for j in range(s - 1, 0, -1) if j in true_chapter), None)
        after = next((true_chapter[j] for j in range(s + 1, n + 1) if j in true_chapter), None)
        if before and before == after:
            true_chapter[s] = before

    # What the database did: the span the taxonomy gave each chapter.
    filed_span = {c["title"]: (c.get("pdfPage"), c.get("pdfPageEnd")) for c in toc}

    per_chapter = {t: {"chunks": 0, "misfiledChunks": [], "pagesFiledHere": set()} for t in toc_titles}
    misfiled_total = 0
    for c in chunks:
        if c["pf"] is None:
            continue
        pages = range(c["pf"], (c["pt"] or c["pf"]) + 1)
        # The seeder stores "Special Relativity (*)" as "Special Relativity".
        strip = lambda t: re.sub(r"\s*\(\s*\*\s*\)\s*$", "", t).strip()
        filed = {strip(ch["chapter"]) for ch in c["chapters"]}
        truth = {true_chapter[p] for p in pages if p in true_chapter}
        for f in filed:
            if f in per_chapter:
                per_chapter[f]["chunks"] += 1
                per_chapter[f]["pagesFiledHere"].update(pages)
        if truth and filed and not (truth & filed):
            misfiled_total += 1
            for f in filed:
                if f in per_chapter:
                    per_chapter[f]["misfiledChunks"].append({
                        "chunk": c["chunk"], "scanPages": [c["pf"], c["pt"]],
                        "printedPages": [numbers[p][0] for p in pages],
                        "belongsTo": sorted(truth), "title": c["title"]})

    chapters = []
    for c in toc:
        t = c["title"]
        own = sorted(s for s, ch in true_chapter.items() if ch == t)
        own_printed = [numbers[s][0] for s in own if numbers[s][0] is not None]
        filed_here = per_chapter[t]["pagesFiledHere"]
        lo, hi = filed_span[t]
        span = set(range(lo, hi + 1)) if lo and hi else set()
        # Where the chapter really opens: the scan carrying its first printed
        # page, else the one carrying the next page, counted back one.
        true_start = None
        if c["startPrinted"] is not None:
            for k in range(0, 3):
                hits = [x for x in range(1, n + 1) if numbers[x][0] == c["startPrinted"] + k]
                if hits:
                    true_start = hits[0] - k
                    break
        chapters.append({
            "title": t,
            "indexPrintedStart": c.get("printed"),
            "startPrinted": c["startPrinted"],
            "startFrom": c["startFrom"],
            "databaseScanSpan": [lo, hi],
            "trueStartScan": true_start,
            "databaseStartMinusTrueStart": (lo - true_start) if (lo and true_start) else None,
            "trueScanPages": compress(own),
            "truePrintedRange": [min(own_printed), max(own_printed)] if own_printed else None,
            "ownPagesOutsideDatabaseSpan": compress(sorted(set(own) - span)),
            "otherChaptersPagesInsideDatabaseSpan": compress(sorted(
                s for s in span if s in true_chapter and true_chapter[s] != t)),
            "chunksFiledHere": per_chapter[t]["chunks"],
            "chunksFiledHereThatBelongElsewhere": len(per_chapter[t]["misfiledChunks"]),
            "misfiledChunks": per_chapter[t]["misfiledChunks"],
        })
    out["chunksFiledUnderWrongChapter"] = misfiled_total
    # Numbered pages no chunk was cut from. Pages before the first chapter's
    # span or between spans are dropped by the chunker, so a chapter placed
    # too late loses its opening pages entirely rather than misfiling them.
    covered = set()
    for c in chunks:
        if c["pf"] is not None:
            covered.update(range(c["pf"], (c["pt"] or c["pf"]) + 1))
    first_body = min((s for s in true_chapter), default=None)
    lost = [s for s in range(1, n + 1) if s not in covered and s in true_chapter]
    out["pagesWithNoDatabaseText"] = {
        "count": len(lost), "scanPages": compress(lost),
        "printedPages": sorted(numbers[s][0] for s in lost if numbers[s][0] is not None),
        "note": "chapter pages of the book no database chunk comes from; some are picture-only pages with nothing to chunk"}
    out["chapters"] = chapters
    return out


def compress(pages):
    """[3,4,5,9] -> ["3-5", "9"]"""
    out, run = [], []
    for p in pages:
        if run and p == run[-1] + 1:
            run.append(p)
        else:
            if run:
                out.append(f"{run[0]}-{run[-1]}" if len(run) > 1 else str(run[0]))
            run = [p]
    if run:
        out.append(f"{run[0]}-{run[-1]}" if len(run) > 1 else str(run[0]))
    return out


def main():
    names = sys.argv[1:] or [k for k in BOOKS if (AUDIT / "marks" / f"{BOOKS[k][1]}.json").exists()]
    for name in names:
        r = audit(name)
        s = r["summary"]
        db = r["database"]
        print(f"{name:20s} scans={r['scanPages']:4d} read={r['pageNumbers']['read']:4d} "
              f"range={r['pageNumbers']['printedRange']} outOfOrder={s['outOfOrderPages']:3d} "
              f"misplaced={s['misplacedPages']:3d} dup={s['duplicatedPrintedPages']:3d} "
              f"missing={s['missingPrintedPages'] if isinstance(s['missingPrintedPages'], str) else format(s['missingPrintedPages'], '3d')} maybeUnread={s['numbersOnlyPossiblyOnUnreadPages']:3d} "
              f"dbMisfiled={db.get('chunksFiledUnderWrongChapter', '-')}/{db.get('chunksInDatabase')}")




def write_summary():
    """corpus/page-audit/LS/_summary.json: one line per book, for reading first."""
    rows = []
    for name in BOOKS:
        path = AUDIT / folder_of(name) / f"{name}.json"
        if not path.exists():
            continue
        r = json.loads(path.read_text(encoding="utf-8"))
        db = r["database"]
        starts = [c["databaseStartMinusTrueStart"] for c in db.get("chapters", [])
                  if c.get("databaseStartMinusTrueStart") is not None]
        rows.append({
            "book": name,
            "files": r["files"],
            "scanPages": r["scanPages"],
            "printedRange": r["pageNumbers"]["printedRange"],
            **r["summary"],
            "databaseBook": r["databaseBook"],
            "relationToDatabase": r["relationToDatabase"],
            "databaseChunks": db.get("chunksInDatabase"),
            "databaseChunksUnderWrongChapter": db.get("chunksFiledUnderWrongChapter"),
            "pagesWithNoDatabaseText": (db.get("pagesWithNoDatabaseText") or {}).get("count"),
            "chapterStartsOffByMoreThan3Scans": sum(1 for x in starts if abs(x) > 3),
            "medianChapterStartShift": sorted(starts)[len(starts) // 2] if starts else None,
            "handNotes": db.get("indexComparison"),
        })
    out = {
        "generated": "2026-09-24 by scripts/corpus/audit_book_pages.py",
        "database": "local Postgres (bac2-db, localhost:5442), exported to corpus/page-audit/db-chunks.json; NOT the live VPS database",
        "howToRead": {
            "outOfOrderPages": "pages not in the longest increasing run of printed numbers; each book is shuffled locally, no page further than largestDistanceFromPlaceInScans from its place",
            "misplacedPages": "pages more than 15 scans from their place, or found by eye in the wrong place",
            "missingPrintedPages": "printed numbers no scan page carries and no unnumbered page could hold",
            "numbersOnlyPossiblyOnUnreadPages": "printed numbers not found, each next to a page that prints no number (chapter openers, full-page pictures) — normal",
            "databaseChunksUnderWrongChapter": "chunks whose scan pages belong, by their printed numbers and the book's contents, to a different chapter than the one they are filed under",
            "medianChapterStartShift": "database chapter start scan minus the scan where the chapter really starts; +-2 is shuffle noise, a steady +4 or more means the chapter offset is wrong",
            "correctOrder": "(in each book file) the scan pages listed in printed order — the order to rebuild the PDF in",
        },
        "books": rows,
    }
    (AUDIT / "LS" / "_summary.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
    write_summary()
