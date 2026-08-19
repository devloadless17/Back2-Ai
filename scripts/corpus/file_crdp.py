# -*- coding: utf-8 -*-
"""Files downloaded CRDP papers into corpus/exams, or refuses to.

    python scripts/corpus/file_crdp.py --plan       what would move, and where
    python scripts/corpus/file_crdp.py --apply

The inbox holds whatever the site published for a session, and two things in it
would quietly corrupt the corpus if copied in without looking.

BREVET PAPERS. A third of what the exam listing returns is الشهادة المتوسطة —
the grade-9 certificate, not the Baccalaureate. Filed as Bac material it would
put grade-9 questions in a grade-12 student's practice, under grade-12 chapters,
and nothing downstream would flag it: the papers are real, well formed, and in
the right subjects. They are identified by the BR_ filename prefix and by
المتوسطة in the title, and both are checked because either alone could change.

RETIRED TRACK CODES. The site names tracks with the French initialisms this
project deliberately migrated away from — SG, SV, SE, LH. Copying those in as
folder names would recreate the two-parallel-curricula bug that `db:prune` was
written to clean up. They are translated here, once:

    SG -> GS      Sciences Générales
    SV -> LS      Sciences de la Vie
    SE -> SE      Sociologie-Économie
    LH -> LH      Littérature-Humanités

A paper serving two tracks (SVSG, SELH) is filed into both. That is not
duplication for its own sake: each track has its own subject rows, its own
chapters and its own mastery, so a shared paper genuinely belongs to each, and
the loader keys questions per subject so neither track's copy collides with the
other's.
"""

import argparse
import json
import re
import shutil
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INBOX = ROOT / "corpus" / "crdp-inbox"
EXAMS = ROOT / "corpus" / "exams"

# Filename prefix -> the tracks this project uses.
TRACKS = {
    "SG": ["gs"],
    "SV": ["ls"],
    "SE": ["se"],
    "LH": ["lh"],
    "SVSG": ["ls", "gs"],
    "SGSV": ["ls", "gs"],
    "SELH": ["se", "lh"],
    "LHSE": ["se", "lh"],
}

BREVET_PREFIX = "BR"
BREVET_TITLE = "المتوسطة"


def session_of(label: str) -> tuple:
    """(year, session number) from a session label like 'دورة أولى - 2021'."""
    year = re.search(r"(20\d\d)", label or "")
    if not year:
        return None, None
    # The site publishes two sittings: the ordinary one and the retake. The
    # corpus numbers them 1 and 2, which is what its folder names already use.
    second = "استثنائية" in (label or "")
    return year.group(1), 2 if second else 1


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    if not (args.plan or args.apply):
        ap.print_help()
        return

    moves = []
    skipped = Counter()
    unknown = []

    for sidecar in sorted(INBOX.glob("*.pdf.json")):
        pdf = INBOX / sidecar.name[: -len(".json")]
        if not pdf.exists():
            skipped["sidecar with no pdf"] += 1
            continue

        meta = json.loads(sidecar.read_text(encoding="utf-8"))
        title = meta.get("title", "")
        prefix = pdf.stem.split("_")[0].upper()

        if prefix == BREVET_PREFIX or BREVET_TITLE in title:
            skipped["brevet, not baccalaureate"] += 1
            continue

        tracks = TRACKS.get(prefix)
        if not tracks:
            unknown.append(pdf.name)
            skipped[f"unrecognised track prefix {prefix}"] += 1
            continue

        year, number = session_of(meta.get("session", ""))
        if not year:
            skipped["no year in the session label"] += 1
            continue

        for track in tracks:
            moves.append((pdf, EXAMS / track / f"{year} {number}" / pdf.name))

    print(f"{len(moves)} file placements from {len(set(m[0] for m in moves))} papers")
    for reason, count in skipped.most_common():
        print(f"  skipped: {reason:<34}{count}")
    if unknown:
        print(f"  unrecognised: {', '.join(unknown[:6])}")

    by_track = Counter(m[1].parts[-3] for m in moves)
    print()
    print("  " + "  ".join(f"{track}: {count}" for track, count in sorted(by_track.items())))

    if args.plan:
        print()
        for source, target in moves[:8]:
            print(f"  {source.name:<30}-> {target.relative_to(ROOT)}")
        print("  ...")
        return

    written = 0
    for source, target in moves:
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            continue
        shutil.copy2(source, target)
        written += 1

    print()
    print(f"{written} file(s) copied into corpus/exams")
    print("Next:  python scripts/corpus/extract_exams.py   then   npm run corpus:exams")


if __name__ == "__main__":
    sys.exit(main())
