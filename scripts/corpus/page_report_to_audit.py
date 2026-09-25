# -*- coding: utf-8 -*-
"""Turns a scan page-order report into a page audit this repo can apply.

    python scripts/corpus/page_report_to_audit.py "<report>.json"
    python scripts/corpus/page_report_to_audit.py "<report>.json" --apply

The reports come from a pass that read every page image by eye. They are not in
the shape `taxonomy_page_order.py` wants, and converting one by hand was fine
once; there are 37 books left.

WHAT IT CHECKS BEFORE WRITING. A report is trusted only if it survives the test
the economics one did: its printed numbers must cover a contiguous range with no
gap and no duplicate. A single misread number breaks that, which is what makes
it worth checking — our own OCR of the same book fails it (18 duplicate page
numbers on economics, from ٢ read as ٣).

It also refuses a report whose sha256 is not the file on disk, and one whose
chapter starts do not come out in ascending order — both mean the report and
this corpus are not looking at the same book.

ONE BOOK, SEVERAL TAXONOMIES. The same scan is filed once per track:
`biology-lh-en__39d396cf` and `biology-se-en__39d396cf` are one PDF, and
reordering one without the other leaves half the corpus shuffled. The report
names its own book key and the sha finds the rest — NOT the sha alone, because
a key's suffix is not always the PDF's sha8. `ejtema3-se__7fa192d5` is a file
whose sha8 is `8fc32bda`, and reading the key off the sha made three books look
like a file mismatch when they were byte-identical to what the report audited.

It does not edit `taxonomy_page_order.py`. It prints the line to add there,
because that file is hand-maintained and carries per-book overrides that should
be read by a person, not appended to by a script.
"""

import argparse
import glob
import hashlib
import json
import os
import pathlib
import sys
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
AUDIT = ROOT / "corpus" / "page-audit"
TAX = ROOT / "corpus" / "taxonomy"


def order_by_scan(report: dict) -> dict:
    """scan page -> where it belongs, as a position in the corrected book.

    NOT the printed number, which is what this used at first. A printed number
    is the wrong key for three reasons the reports themselves show:

      * pages print no number at all — covers, chapter openers, full-page
        figures — so the sequence has holes that have to be filled back in;
      * a book can MISPRINT its own numbers. The LH Themes workbook labels its
        pages 170-183 as 172-185, so 176 and 180 each appear twice and nothing
        is wrong with the scan;
      * a book can restart or skip numbering entirely.

    `belongs_at_pdf_page` has none of those problems. The report gives it for
    every page, and `reading_order` is a clean permutation of 1..N, so it is a
    total order by construction — no gaps, no duplicates, nothing to infer.
    """
    order = {row["pdf_page"]: row["belongs_at_pdf_page"] for row in report["misplaced_pages"]}
    for page in report.get("pages_already_in_place", []):
        order.setdefault(page, page)   # in place: it belongs where it is
    return order


def printed_by_scan(report: dict) -> dict:
    """scan page -> the number printed on it, where it prints one."""
    printed = {row["pdf_page"]: row["printed_page"] for row in report["misplaced_pages"]}
    for page in report.get("pages_already_in_place", []):
        printed.setdefault(page, page - 2)
    return printed


def check(report: dict, order: dict) -> list:
    """Everything wrong with this report, or an empty list.

    The test is on the ORDER, which must be a permutation of 1..N: every page
    accounted for, every position filled exactly once. That is what makes the
    report usable, and it is strong — a single wrong entry creates both a
    duplicate and a hole.
    """
    problems = []
    pages = report["book"]["pdf_pages"]
    every = set(range(1, pages + 1))

    if set(order) != every:
        problems.append(f"report covers {len(order)} of {pages} pdf pages")
    positions = sorted(order.values())
    if positions != sorted(every):
        dups = sorted(v for v, c in Counter(order.values()).items() if c > 1)
        holes = sorted(every - set(order.values()))
        problems.append(f"positions are not a permutation of 1-{pages}: "
                        f"{len(dups)} repeated {dups[:6]}, {len(holes)} unfilled {holes[:6]}")

    stated = report.get("reading_order")
    if stated:
        if sorted(stated) != sorted(every):
            problems.append("reading_order is not a permutation of the pages")
        else:
            # reading_order[k] is the page that belongs at position k+1; it must
            # say the same thing as belongs_at_pdf_page, or the report disagrees
            # with itself.
            from_order = {page: i + 1 for i, page in enumerate(stated)}
            disagree = [p for p in order if from_order.get(p) != order[p]]
            if disagree:
                problems.append(f"{len(disagree)} page(s) where reading_order and "
                                f"belongs_at_pdf_page disagree: {disagree[:6]}")

    # The reports are written against a tree where the ebooks sit at
    # `bac2/crdp ebooks`; here they are under `corpus/`. Both spellings are
    # tried, then the basename anywhere, so a report is never rejected over a
    # path convention when the file is plainly present.
    local = None
    for rel in report["book"]["files"]:
        tail = rel.replace("bac2/", "", 1)
        for candidate in (ROOT / "corpus" / tail, ROOT / tail):
            if candidate.exists():
                local = candidate
                break
        if local is None:
            hits = glob.glob(str(ROOT / "corpus" / "**" / os.path.basename(rel)), recursive=True)
            if hits:
                local = pathlib.Path(hits[0])
        if local:
            break

    if local is None:
        # A warning, not a refusal: some audited books are not in this repo at
        # all. The chapter-start check below still has to resolve against the
        # taxonomy, which a report for the wrong book could not do.
        print("  WARNING  none of the report's files are on disk — sha NOT checked")
    elif hashlib.sha256(local.read_bytes()).hexdigest() != report["book"]["sha256"]:
        problems.append(f"sha256 differs from {local.relative_to(ROOT)}")
    return problems


def taxonomies_for(report: dict) -> list:
    """Every taxonomy this scan is filed under.

    The report's own `corpus_book_key` comes first, because a book key's suffix
    is NOT always the PDF's sha8: `ejtema3-se__7fa192d5` is a file whose sha8 is
    8fc32bda. Deriving the key from the sha found nothing for three books and
    read as a file mismatch when the files were byte-identical to the report's.

    The sha is still used to find the OTHER taxonomies holding the same scan —
    one PDF filed under two tracks — which is how biology gets both its keys.
    """
    keys = []
    stated = report["book"].get("corpus_book_key")
    if stated and (TAX / f"{stated}.json").exists():
        keys.append(stated)
    for path in sorted(glob.glob(str(TAX / f"*__{report['book']['sha256'][:8]}.json"))):
        key = os.path.basename(path)[:-5]
        if key not in keys:
            keys.append(key)
    return keys


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("report")
    ap.add_argument("--name", default=None, help="audit name; default from the book key")
    ap.add_argument("--track", default="SE", help="folder under corpus/page-audit")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    report = json.loads(pathlib.Path(args.report).read_text(encoding="utf-8"))
    book = report["book"]
    sha8 = book["sha256"][:8]
    order = order_by_scan(report)
    printed = printed_by_scan(report)

    problems = check(report, order)
    print(f"{book.get('title', '?')}  —  {book['corpus_book_key']}  ({book['pdf_pages']} pages)")
    for p in problems:
        print(f"  PROBLEM  {p}")
    if problems:
        sys.exit("\nrefusing to write an audit from a report that does not check out")
    print(f"  reading order is a clean permutation of 1-{book['pdf_pages']}")

    keys = taxonomies_for(report)
    if not keys:
        sys.exit(f"  no taxonomy in this repo for {book['corpus_book_key']} (sha8 {sha8})")
    print(f"  taxonomies sharing this scan: {', '.join(keys)}")

    # A CHAPTER CAN OPEN ON A PAGE THAT PRINTS NO NUMBER — a full-page heading,
    # a unit opener. Reading the start straight off `printed` left 3, 5 and 7
    # chapters unresolved on the two English books and physics.
    #
    # `taxonomy_page_order.keys_for` already answers this: it gives every page a
    # sort key, and an unnumbered one takes the printed number missing beside it
    # or, failing that, a position between its neighbours. Using the same
    # function means a chapter's start is on the same scale as the keys its
    # pages are later selected by, which two separate rules could not guarantee.
    page_keys = order
    # THE REPORT'S OWN CHAPTER OPENINGS WIN, where it gives them.
    #
    # A taxonomy start is a scan page somebody derived; the report read the
    # book's title cards off the pages and says where each chapter actually
    # opens. On four books they disagree and the report is right — six of the
    # nine starts in `taxonomy_francais_oeuvre.py` land inside another chapter,
    # filing 17 pages of L'Étranger under L'Émigré de Brisbane. Its docstring
    # explains the offsets as uncounted image plates; every page of this scan
    # carries a printed number, so that cannot be it.
    #
    # Matched on the title, which is identical in the taxonomy and the report
    # for all 23 books. A chapter the report does not name keeps the old route.
    # ONLY WHERE THE REPORT SAYS OUR START IS WRONG, which it states outright
    # with `taxonomy_start_is_the_opening_page: false`. Four reports make that
    # claim, about 22 chapters in total.
    #
    # Taking `belongs_at_pdf_page` from every opening instead moved starts in 18
    # of 22 books, on no evidence at all. Most of those reports never look at our
    # taxonomy: chemistry's openings carry `first_page` and `contents_page` — the
    # page the chapter opens on and the page its contents entry names, which
    # differ by one throughout that book. That is a boundary convention, not an
    # error, and adopting it silently would have shifted thirteen chapters of a
    # book the report says nothing is wrong with.
    openings = {c["chapter"]: c["belongs_at_pdf_page"]
                for c in (report.get("effect_on_the_corpus") or {}).get("chapter_openings", [])
                if c.get("taxonomy_start_is_the_opening_page") is False
                and c.get("belongs_at_pdf_page")}
    corrected = []

    starts, missing = [], []
    tax = json.loads((TAX / f"{keys[0]}.json").read_text(encoding="utf-8"))
    for c in tax["chapters"]:
        # THE ORIGINAL HEADING PAGE, not the current one. Once a book has been
        # reordered, `pdfPage` holds the FIRST PAGE IN CORRECTED ORDER, and
        # `taxonomy_page_order` keeps the scan page the heading was found on in
        # `beforePageOrder`. Reading `pdfPage` on an already-reordered book
        # therefore feeds a corrected page back in as if it were a scan page —
        # which took LH general philosophy from 1 broken chapter to 12.
        before = c.get("beforePageOrder") or {}
        heading = before.get("pdfPage") or c.get("pdfPage")
        if not heading:
            continue
        derived = page_keys.get(heading)
        start = openings.get(c["title"], derived)
        if derived is not None and start != derived:
            corrected.append((c["title"], derived, start))
        starts.append({"title": c["title"], "startPrinted": start})
        if start is None:
            missing.append(c["title"])
    start_order = [s["startPrinted"] for s in starts]
    if missing:
        print(f"  PROBLEM  {len(missing)} chapter start(s) have no printed number")
    elif start_order != sorted(start_order):
        print(f"  PROBLEM  chapter starts are not ascending: {start_order}")
    else:
        print(f"  {len(starts)} chapter starts, ascending: {start_order[0]}…{start_order[-1]}")
    if corrected:
        print(f"  {len(corrected)} start(s) corrected from the report's own chapter openings:")
        for title, was, now in corrected[:8]:
            print(f"      {title[:40]:<42}{was} -> {now}")
    if missing or start_order != sorted(start_order):
        sys.exit("\nrefusing: chapter starts do not resolve")

    name = args.name or book["corpus_book_key"].split("__")[0].replace("-", "_")
    audit = {
        "book": name,
        "files": book["files"],
        "sha8": sha8,
        "scanPages": book["pdf_pages"],
        "databaseBook": keys[0],
        "alsoFiledAs": keys[1:],
        "relationToDatabase": "same file, same scan order",
        "source": f"{os.path.basename(args.report)}, converted by page_report_to_audit.py",
        # `printed` here is the page's CORRECTED POSITION, not the number
        # printed on it: `taxonomy_page_order.keys_for` sorts on this field and
        # a position is the key that always exists and never repeats. The number
        # actually printed is kept beside it for anyone reading the file.
        "pageMap": [{"scan": s, "printed": order[s], "printedOnPage": printed.get(s),
                     "how": "page-order report, corrected position"}
                    for s in range(1, book["pdf_pages"] + 1)],
        "pinnedKeys": {},
        "database": {"chapters": starts},
    }

    # ONE AUDIT FILE PER TAXONOMY, because `taxonomy_page_order.py` keys its
    # BOOKS map by audit name and resolves the file from that name. A scan filed
    # under two tracks needs two entries, so it needs two files. They are
    # generated and identical apart from `databaseBook`; the alternative is an
    # alias mechanism in a hand-maintained file, for no gain.
    written = []
    for key in keys:
        per = dict(audit, databaseBook=key, alsoFiledAs=[k for k in keys if k != key])
        per_name = args.name or key.replace("-", "_")
        out = AUDIT / args.track / f"{per_name}.json"
        if args.apply:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(per, ensure_ascii=False, indent=1), encoding="utf-8")
        written.append((per_name, key, out))

    print()
    for per_name, key, out in written:
        verb = "wrote" if args.apply else "would write"
        print(f"{verb} {out.relative_to(ROOT)}")
    if not args.apply:
        print("(pass --apply)")

    print("\nadd to BOOKS in scripts/corpus/taxonomy_page_order.py:")
    for per_name, key, _ in written:
        print(f'    "{per_name}": "{key}",')
    print("\nthen:")
    for per_name, _, _ in written:
        print(f"  python scripts/corpus/taxonomy_page_order.py {per_name} --apply")
    print(f"  npm run corpus:chunks -- --book {','.join(keys)}")
    print("  npm run ingest -- --embed-missing")


if __name__ == "__main__":
    main()
