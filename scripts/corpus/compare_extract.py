# -*- coding: utf-8 -*-
"""Did a change to the extractor help, and what did it cost?

    python scripts/corpus/compare_extract.py --save before   # on the old code
    python scripts/corpus/compare_extract.py --against before # on the new code

Every improvement to `extract_exams.py` is a regex meeting two thousand PDFs,
and the summary it prints counts only what worked. A change that recovers three
hundred marking schemes and quietly truncates a thousand statements shows up in
that summary as an unambiguous win.

That is not hypothetical. Splitting the paper on its mark column looked correct,
read correctly, and cost 683 sub-questions and 45 answers per 250 papers to
recover none — and the only reason it was caught is that the old code was run
over the same sample afterwards. This makes that comparison a command rather
than a thing somebody remembers to do.

What it compares is the per-exercise detail rather than the totals: an exercise
is keyed by its paper, its index and its statement, so a statement that changed
shows up as one lost and one gained rather than as no change at all.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOTS = ROOT / "corpus" / ".extract-snapshots"

# Deliberately NOT corpus/exams.json. This script runs the extractor over a
# sample, and the loader's reconciliation pass retires any question absent from
# the file it reads — so a 250-paper comparison run landing on the real
# exams.json would retire every question from the other 1,750 papers the next
# time `npm run corpus:exams` was run. Comparison output is scratch.
SCRATCH = SNAPSHOTS / "_current.json"


def run_extractor(limit: int) -> None:
    cmd = [sys.executable, str(Path(__file__).with_name("extract_exams.py")),
           "--out", str(SCRATCH)]
    if limit:
        cmd += ["--limit", str(limit)]
    subprocess.run(cmd, check=True, cwd=ROOT)


def summarise(papers: list) -> dict:
    exercises = [e for p in papers for e in p["exercises"]]
    return {
        "papers": len(papers),
        "exercises": len(exercises),
        "sub-questions": sum(len(e["parts"]) for e in exercises),
        "answers": sum(p["answersFound"] for p in papers),
        "marks": sum(p.get("marksFound", 0) for p in papers),
        "papers with a scheme": sum(1 for p in papers if p["answersFound"]),
        "scheme suspected, unread": sum(
            1 for p in papers if p.get("schemeSuspected") and not p["answersFound"]
        ),
        "statements like a scheme": sum(p.get("schemeInStatement", 0) for p in papers),
    }


def statements(papers: list) -> dict:
    """Every exercise, keyed by identity, valued by what we stored for it."""
    out = {}
    for p in papers:
        for e in p["exercises"]:
            out[(p["path"], e["index"])] = {
                "statement": e["statement"],
                "parts": len(e["parts"]),
                "answers": sum(1 for q in e["parts"] if "answer" in q),
                "marks": sum(1 for q in e["parts"] if "marks" in q),
            }
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--save", metavar="NAME", help="run the extractor and keep the result under NAME")
    ap.add_argument("--against", metavar="NAME", help="run the extractor and diff it against NAME")
    ap.add_argument("--limit", type=int, default=250)
    args = ap.parse_args()

    if not args.save and not args.against:
        ap.error("one of --save or --against is required")

    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    run_extractor(args.limit)
    current = json.loads(SCRATCH.read_text(encoding="utf-8"))

    if args.save:
        target = SNAPSHOTS / f"{args.save}.json"
        target.write_text(json.dumps(current, ensure_ascii=False), encoding="utf-8")
        print(f"\nsaved {len(current)} papers -> {target}")
        for k, v in summarise(current).items():
            print(f"  {k:26} {v}")
        return

    target = SNAPSHOTS / f"{args.against}.json"
    if not target.exists():
        sys.exit(f"No snapshot named {args.against}. Run --save {args.against} on the old code first.")
    before = json.loads(target.read_text(encoding="utf-8"))

    print(f"\n{'':28}{args.against:>12}{'now':>12}{'change':>12}")
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
        for key, was, now in sorted(shorter, key=lambda x: x[1] - x[2], reverse=True)[:5]:
            print(f"      -{was - now:>6} chars  {key[0]} #{key[1]}")
    for key in lost[:5]:
        print(f"      LOST  {key[0]} #{key[1]}")


def _worse(metric: str, delta: int) -> bool:
    """Growth is good everywhere except the two lines that count what we missed."""
    if metric in ("scheme suspected, unread", "statements like a scheme"):
        return delta > 0
    return delta < 0


if __name__ == "__main__":
    sys.exit(main())
