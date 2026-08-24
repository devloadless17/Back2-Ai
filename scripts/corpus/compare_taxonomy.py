# -*- coding: utf-8 -*-
"""Did a change to the chapter locator help, and what did it cost?

    python scripts/corpus/compare_taxonomy.py --save before   # on the old code
    python scripts/corpus/compare_taxonomy.py --against before # on the new code

The same discipline `compare_extract.py` enforces for the exam parser, for the
other half of the corpus. `taxonomy.py` prints how many chapters it placed, and
placing a chapter is not the same as placing it correctly: the locator that gave
"Alcohols" three pages instead of twenty-six reported it as located, and the
book's summary line was unchanged. Every failure this file exists to catch is
invisible in that summary by construction.

So the comparison is per chapter and it is about SPANS, not counts:

  lost       placed before, unplaced now — always a regression
  gained     unplaced before, placed now — the thing a locator fix is for
  shrunk     a span that got shorter, which is the Alcohols failure happening
             to some other chapter, and is a regression until read
  grown      a span that got longer, which is the Alcohols failure being fixed,
             and is equally worth reading before believing

A chapter's span is the material a student can retrieve for it. A span that
moves is a different set of pages behind the same chapter name, so `--verbose`
prints the first line of the new opening page: that line is how you tell a
chapter heading from a passing mention without trusting the parser that just
placed it.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TAXONOMY = ROOT / "corpus" / "taxonomy"
TEXT = ROOT / "corpus" / "text"
SNAPSHOTS = ROOT / "corpus" / ".taxonomy-snapshots"


def run_taxonomy() -> None:
    subprocess.run([sys.executable, str(Path(__file__).with_name("taxonomy.py"))],
                   check=True, cwd=ROOT)


def collect() -> dict:
    """Every chapter in every book, keyed by (book, index, title)."""
    out = {}
    for path in sorted(TAXONOMY.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        book = data.get("book", path.stem)
        for c in data.get("chapters", []):
            key = f"{book}\t{c.get('index')}\t{c.get('title')}"
            start, end = c.get("pdfPage"), c.get("pdfPageEnd")
            out[key] = {
                "start": start,
                "end": end,
                # Inclusive, and None where the chapter was never placed.
                "pages": None if not start else (end or start) - start + 1,
            }
    return out


def first_line(book: str, page) -> str:
    """The opening line of a page, for telling a heading from a mention."""
    if not page:
        return ""
    f = TEXT / book / "clean" / f"page-{int(page):03d}.md"
    if not f.exists():
        return "(no text)"
    for line in f.read_text(encoding="utf-8").split("\n"):
        if line.strip():
            return line.strip()[:70]
    return "(blank)"


def summarise(chapters: dict) -> dict:
    placed = [c for c in chapters.values() if c["start"]]
    thin = [c for c in placed if c["pages"] is not None and c["pages"] < 3]
    return {
        "chapters": len(chapters),
        "placed": len(placed),
        "UNPLACED": len(chapters) - len(placed),
        "spans under 3 pages": len(thin),
        "pages covered": sum(c["pages"] or 0 for c in placed),
    }


def _worse(metric: str, delta: int) -> bool:
    """Growth is good except on the two lines that count what went wrong."""
    if metric in ("UNPLACED", "spans under 3 pages"):
        return delta > 0
    return delta < 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--save", metavar="NAME", help="run the parser and keep the result under NAME")
    ap.add_argument("--against", metavar="NAME", help="run the parser and diff it against NAME")
    ap.add_argument("--verbose", action="store_true", help="list every moved span, not the first 15")
    ap.add_argument("--book", help="restrict the per-chapter diff to one book")
    ap.add_argument("--no-run", action="store_true", help="read corpus/taxonomy as it stands")
    args = ap.parse_args()

    if not args.save and not args.against:
        ap.error("one of --save or --against is required")

    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    if not args.no_run:
        run_taxonomy()
    current = collect()

    if args.save:
        target = SNAPSHOTS / f"{args.save}.json"
        target.write_text(json.dumps(current, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\nsaved {len(current)} chapters -> {target}")
        for k, v in summarise(current).items():
            print(f"  {k:22} {v}")
        return

    target = SNAPSHOTS / f"{args.against}.json"
    if not target.exists():
        sys.exit(f"No snapshot named {args.against}. Run --save {args.against} on the old code first.")
    before = json.loads(target.read_text(encoding="utf-8"))

    print(f"\n{'':24}{args.against:>12}{'now':>12}{'change':>12}")
    a, b = summarise(before), summarise(current)
    for k in a:
        delta = b[k] - a[k]
        flag = "" if delta == 0 else ("  <-- WORSE" if _worse(k, delta) else "  <-- better")
        print(f"  {k:22}{a[k]:>12}{b[k]:>12}{delta:>+12}{flag}")

    keys = [k for k in set(before) | set(current) if not args.book or k.startswith(args.book)]
    lost, gained, shrunk, grown, moved = [], [], [], [], []
    # A chapter can also stop existing, or start existing, rather than merely
    # moving: a retitled chapter is a new key and its old key vanishes, and a
    # book parsed for the first time arrives as a page of new keys. Skipping
    # those quietly would report a renamed chapter as no change at all, which
    # is the class of silence this whole file exists to break.
    only_before = [k for k in sorted(keys) if k not in current]
    only_now = [k for k in sorted(keys) if k not in before]
    for k in sorted(keys):
        o, n = before.get(k), current.get(k)
        if not o or not n:
            continue
        if o["start"] and not n["start"]:
            lost.append(k)
        elif n["start"] and not o["start"]:
            gained.append(k)
        elif o["start"] and n["start"]:
            if n["pages"] < o["pages"]:
                shrunk.append(k)
            elif n["pages"] > o["pages"]:
                grown.append(k)
            if n["start"] != o["start"]:
                moved.append(k)

    print(f"\n  chapters no longer placed      {len(lost)}")
    print(f"  chapters newly placed          {len(gained)}")
    print(f"  spans that SHRANK              {len(shrunk)}")
    print(f"  spans that grew                {len(grown)}")
    print(f"  openings that moved            {len(moved)}")
    print(f"  chapter gone from the list     {len(only_before)}")
    print(f"  chapter new to the list        {len(only_now)}")

    cap = None if args.verbose else 15

    def show(label: str, items: list) -> None:
        if not items:
            return
        print(f"\n  {label}")
        for k in items[:cap]:
            book, index, title = k.split("\t")
            o, n = before.get(k, {}), current.get(k, {})
            print(f"    {book[:24]:24} {title[:34]:34} "
                  f"{str(o.get('start')):>5}-{str(o.get('end')):<5} -> "
                  f"{str(n.get('start')):>5}-{str(n.get('end')):<5}")
            if n.get("start") != o.get("start"):
                print(f"        now opens: {first_line(book, n.get('start'))}")
        if cap and len(items) > cap:
            print(f"    ... and {len(items) - cap} more (--verbose)")

    show("GONE — this chapter key is no longer produced at all:", only_before)
    show("NEW — this chapter key did not exist before:", only_now)
    show("LOST — placed before, unplaced now:", lost)
    show("SHRANK — a shorter span is a truncated chapter until read:", shrunk)
    show("newly placed:", gained)
    show("grew:", grown)


if __name__ == "__main__":
    sys.exit(main())
