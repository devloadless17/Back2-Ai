# -*- coding: utf-8 -*-
"""Which textbook pages did Mathpix read out of order?

    python scripts/corpus/audit_book_column_order.py
    python scripts/corpus/audit_book_column_order.py --book math-er__9de6de98 --show 5

Costs nothing. Reads only the Mathpix markdown already on disk: no model, no
OCR, no page rendering.

WHY. Exercise pages are printed in two columns and Mathpix returns one stream,
so lines from the two columns interleave: math-er page 28 reads exercise 6, then
exercise 14, then exercise 7. Splitting that on numbers would hand students
broken statements, which is why `extract_book_exercises.py` pays a vision model
to put each page back in reading order.

That model is being paid to read every page, including the ones that were never
scrambled — math-er page 18 comes back from Mathpix already perfect. This says
which pages actually need the help, so the paid step can be pointed at those.

THE SIGNAL IS THE NUMBERING. An exercise list counts up. Where the numbers stop
counting up, something from the other column has been spliced in.

NOT EVERY DROP IS A FAULT, and conflating them was the first version's mistake.
A page often prints two lists — EXERCISES 1,2,3 then SELF-EVALUATION 1,2,3 — and
the restart to 1 is the page doing what it should. So drops are split:

  RESTART      the sequence falls back to 1 or 2. A new list beginning.
  INTERLEAVED  it falls back to something else, or jumps far ahead and returns:
               6, 14, 7. Only this shape means the columns were mixed.
  PAGE NUMBER  a value an order of magnitude above its neighbours (1,2,3,326).
               Mathpix caught the printed page number as a list item. A
               different fault, reported separately because re-ordering will
               not fix it.

The classification is reported per book, never as one blended number, because
"51% of pages are broken" was that blend and it was wrong.
"""
import csv
import io
import os
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path.cwd()
CATALOG = ROOT / "scripts/corpus/catalog.csv"
TEXT = ROOT / "corpus/text"

#: A numbered exercise, in both forms Mathpix leaves on disk.
#:
#: `document.mmd` and the top-level page files keep the LaTeX list markup,
#: `\item[6.]`. The `clean/` variant — which is the one
#: `extract_book_exercises.py` reads, so the one that matters — has already
#: flattened that to a plain `6.` at the start of a line. A detector that knew
#: only the first form reported every book as having no numbered list at all.
ITEM_LATEX = re.compile(chr(92) * 2 + r"item\[(\d+)\.?\]")
#: `6.` and `6)` are both used, and which one depends on the book rather than on
#: anything systematic: math-er numbers with `6.` on 159 pages and `6)` on one,
#: while chemistry-en and chimie-fr use `6)` throughout and have not a single
#: `6.` between them. Matching only the first reported those two books, and
#: physics-en, as having no numbered exercises at all — 59 pages missed.
ITEM_PLAIN = re.compile(r"(?m)^ {0,3}(\d{1,3})[.)]\s")


def item_numbers(text):
    found = ITEM_LATEX.findall(text)
    return [int(n) for n in (found or ITEM_PLAIN.findall(text))]
#: Folders whose subject is a science or maths; the Arabic editions are excluded
#: upstream and have no exercise pages of this shape anyway.
SUBJECTS = ("math", "bio", "chem", "chimie", "physic", "physique", "svt")

#: A fall to this or below is a list restarting, not a column mixed in.
RESTART_AT = 2
#: A value this many times its neighbour is the printed page number, not an item.
PAGE_NUMBER_RATIO = 10


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def classify(nums):
    """('clean' | 'restart' | 'interleaved' | 'page-number', the run of numbers)."""
    if len(nums) < 2:
        return "clean"
    big = max(nums)
    small = min(n for n in nums if n > 0)
    if big >= small * PAGE_NUMBER_RATIO and big > 50:
        return "page-number"
    verdict = "clean"
    for a, b in zip(nums, nums[1:]):
        if b >= a:
            continue
        verdict = "restart" if b <= RESTART_AT and verdict == "clean" else "interleaved"
    return verdict


def pages_of(folder):
    for sub in (TEXT / folder / "clean", TEXT / folder):
        if sub.is_dir():
            found = sorted(sub.glob("page-*.md"))
            if found:
                return found
    return []


def main():
    only = arg("--book")
    show = int(arg("--show", 0))

    rows = list(csv.DictReader(io.open(CATALOG, encoding="utf-8-sig")))
    books = [r for r in rows if any(k in r["folder"] for k in SUBJECTS)]
    if only:
        books = [r for r in books if r["folder"] == only]

    totals = {"clean": 0, "restart": 0, "interleaved": 0, "page-number": 0}
    print()
    print(f"  {'book':<38} {'pages':>6} {'listed':>7} {'mixed':>6} {'pagenum':>8} {'restart':>8}")
    print(f"  {'-' * 38} {'-' * 6} {'-' * 7} {'-' * 6} {'-' * 8} {'-' * 8}")

    examples = []
    for r in books:
        folder = r["folder"]
        pages = pages_of(folder)
        counts = {"clean": 0, "restart": 0, "interleaved": 0, "page-number": 0}
        for p in pages:
            nums = item_numbers(p.read_text(encoding="utf-8", errors="replace"))
            if len(nums) < 2:
                continue
            verdict = classify(nums)
            counts[verdict] += 1
            if verdict in ("interleaved", "page-number") and len(examples) < show:
                examples.append((folder, p.name, verdict, nums[:10]))
        listed = sum(counts.values())
        for k in totals:
            totals[k] += counts[k]
        if not pages:
            print(f"  {folder:<38} {'-- no text on disk --':>38}")
            continue
        print(
            f"  {folder:<38} {len(pages):>6} {listed:>7} "
            f"{counts['interleaved']:>6} {counts['page-number']:>8} {counts['restart']:>8}"
        )

    listed = sum(totals.values())
    print()
    print(f"  pages with a numbered list        {listed}")
    print(f"  columns mixed (needs re-ordering) {totals['interleaved']}")
    print(f"  page number read as an item       {totals['page-number']}")
    print(f"  list restarts (nothing wrong)     {totals['restart']}")
    print(f"  already in order                  {totals['clean']}")
    print()
    for folder, page, verdict, nums in examples:
        print(f"    {folder} {page}  {verdict}  {nums}")
    if examples:
        print()


if __name__ == "__main__":
    main()
