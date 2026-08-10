# -*- coding: utf-8 -*-
"""Inventory a folder of PDFs: page count, size, hash, and duplicates.

    python scripts/corpus/inventory.py "C:/Users/96181/Downloads/books"

Answers the question the spreadsheets cannot: is the GS chemistry book the same
file as the LS chemistry book? Two files with the same SHA-256 are the same
book and must be transcribed once; two files with the same page count but
different hashes are different editions and must both be done.

Writes books-inventory.csv next to the folder so the result is a document, not
a terminal scroll.
"""

import csv
import hashlib
import sys
from collections import defaultdict
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    print("pypdf is needed:  pip install pypdf")
    raise SystemExit(1)


def main(folder: str) -> None:
    root = Path(folder)
    if not root.is_dir():
        raise SystemExit(f"Not a folder: {root}")

    pdfs = sorted(root.rglob("*.pdf"))
    if not pdfs:
        raise SystemExit(f"No PDFs under {root}")

    rows = []
    by_hash = defaultdict(list)

    for path in pdfs:
        data = path.read_bytes()
        sha = hashlib.sha256(data).hexdigest()
        try:
            pages = len(PdfReader(path).pages)
        except Exception as err:  # a broken PDF should be reported, not fatal
            pages = -1
            print(f"  ! {path.name}: cannot read ({type(err).__name__})")

        rows.append(
            {
                "file": str(path.relative_to(root)),
                "pages": pages,
                "mb": round(len(data) / 1024 / 1024, 1),
                "sha8": sha[:8],
                "sha256": sha,
            }
        )
        by_hash[sha].append(path.name)

    width = max(len(r["file"]) for r in rows)
    print(f"\n{len(rows)} PDFs in {root}\n")
    print(f"  {'file'.ljust(width)}  {'pages':>6}  {'MB':>6}  sha8")
    print(f"  {'-' * width}  {'-' * 6}  {'-' * 6}  {'-' * 8}")
    for r in sorted(rows, key=lambda r: r["file"]):
        print(f"  {r['file'].ljust(width)}  {r['pages']:>6}  {r['mb']:>6}  {r['sha8']}")

    duplicates = {sha: names for sha, names in by_hash.items() if len(names) > 1}
    print()
    if duplicates:
        print("SAME FILE under more than one name — transcribe once:")
        for sha, names in duplicates.items():
            print(f"  {sha[:8]}  {'  =  '.join(names)}")
    else:
        print("No duplicate files. Every PDF here is distinct.")

    # Same length, different content: usually two editions of one title, or one
    # of the two page counts in the tracking sheet is wrong.
    by_pages = defaultdict(list)
    for r in rows:
        if r["pages"] > 0:
            by_pages[r["pages"]].append((r["file"], r["sha8"]))
    lookalikes = {n: v for n, v in by_pages.items() if len({s for _, s in v}) > 1}
    if lookalikes:
        print()
        print("Same page count, DIFFERENT file — check whether these are two editions:")
        for n, entries in sorted(lookalikes.items()):
            print(f"  {n} pages:")
            for name, sha8 in entries:
                print(f"      {sha8}  {name}")

    out = root / "books-inventory.csv"
    with out.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=["file", "pages", "mb", "sha8", "sha256"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nwritten: {out}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit('Usage: python scripts/corpus/inventory.py "C:/path/to/books"')
    main(sys.argv[1])
