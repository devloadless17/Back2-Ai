# -*- coding: utf-8 -*-
"""Diff two extractions that already exist, without re-running the extractor.

    python scripts/corpus/compare_extract_files.py before-ardigits corpus/exams.json

`compare_extract.py` is the command to reach for: it runs the extractor itself,
so the two sides cannot drift. Use this one only when the "after" side is a full
extraction that has ALREADY been produced for another reason — a real
`corpus/exams.json` write, say — because re-running the extractor over 1,951
papers to compare against it costs forty minutes to learn nothing new.

The comparison itself is imported from `compare_extract.py` rather than
reimplemented, so the two commands cannot disagree about what "worse" means.
"""

import argparse
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from compare_extract import SNAPSHOTS, _worse, statements, summarise  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]


def load(name: str) -> list:
    """A snapshot by name, or any extraction by path."""
    path = pathlib.Path(name)
    if not path.exists():
        path = SNAPSHOTS / f"{name}.json"
    if not path.exists():
        sys.exit(f"no such extraction: {name}")
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("before", help="snapshot name, or a path")
    ap.add_argument("after", nargs="?", default="corpus/exams.json", help="snapshot name, or a path")
    args = ap.parse_args()

    before, current = load(args.before), load(args.after)

    print(f"{'':28}{args.before[:12]:>12}{'now':>12}{'change':>12}")
    a, b = summarise(before), summarise(current)
    for k in a:
        delta = b[k] - a[k]
        flag = "" if delta == 0 else ("  <-- WORSE" if _worse(k, delta) else "  <-- better")
        print(f"  {k:26}{a[k]:>12}{b[k]:>12}{delta:>+12}{flag}")

    old, new = statements(before), statements(current)
    lost = [k for k in old if k not in new]
    gained = [k for k in new if k not in old]
    shorter = [
        (k, len(old[k]["statement"]), len(new[k]["statement"]))
        for k in old
        if k in new and len(new[k]["statement"]) < len(old[k]["statement"]) - 20
    ]

    print(f"\n  exercises no longer produced   {len(lost)}")
    print(f"  exercises newly produced       {len(gained)}")
    print(f"  statements that got SHORTER    {len(shorter)}")
    if shorter:
        print("    (a shorter statement is a truncated question until proven otherwise)")
        for key, was, now in sorted(shorter, key=lambda x: x[1] - x[2], reverse=True)[:8]:
            print(f"      -{was - now:>6} chars  {key[0]} #{key[1]}")
    for key in lost[:8]:
        print(f"      LOST  {key[0]} #{key[1]}")


if __name__ == "__main__":
    sys.exit(main())
