# -*- coding: utf-8 -*-
"""Transcribes every exam paper whose own text layer is unusable.

    python scripts/corpus/ocr_dead_exams.py --estimate
    python scripts/corpus/ocr_dead_exams.py
    python scripts/corpus/ocr_dead_exams.py --limit 5

127 of the papers we hold extract almost nothing, or extract nonsense. A PDF
written with a broken font map yields "الوديرية العاهة" where the page reads
"المديرية العامة" — text that is worse than no text, because it embeds without
complaint and retrieves rubbish. No parsing rule reaches those papers, and after
a day of writing rules for the ones that could be reached, they are what is
left.

This finds them and hands each to `ocr_pdf.py`, which writes one markdown file
per page under `corpus/text/<name>__<sha8>/`. `extract_exams.py` looks there,
keyed by the paper's sha256, and uses the transcription only where the text
layer has already failed.

Safe to interrupt. `ocr_pdf.py` skips a page that is already on disk, so a
second run resumes rather than paying twice, and this skips a paper whose pages
are all present.
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

import pypdf

ROOT = Path(__file__).resolve().parents[2]
EXAMS = ROOT / "corpus" / "exams"
TEXT = ROOT / "corpus" / "text"

# Below this many characters per page, the text layer is not worth having. A
# real page of an exam paper runs to two or three thousand; the dead ones come
# back with a few dozen, or with letters that are not the letters on the page.
DEAD_BELOW = 400


def is_dead(pdf: Path) -> tuple:
    try:
        reader = pypdf.PdfReader(str(pdf))
        pages = reader.pages
        text = "".join((page.extract_text() or "") for page in pages)
    except Exception:
        return True, 0
    if not pages:
        return True, 0
    return len(text) / len(pages) < DEAD_BELOW, len(pages)


def slug(relative: Path) -> str:
    """A folder name a person can recognise: track, session, subject."""
    return re.sub(r"[^a-z0-9]+", "-", str(relative).lower()).strip("-")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="gpt-5.4-mini")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--estimate", action="store_true")
    # A ceiling that stops the run, not a warning that follows it. The estimate
    # is ~$2.74 and the arithmetic behind it is sound, but a page that maxes its
    # 4,000 output tokens costs six times an ordinary one, and 588 pages of that
    # would be $11.69. This makes the estimate enforceable: spend is totalled
    # from what the API itself reports, and the run stops the moment it crosses
    # the limit, mid-corpus, with everything already transcribed kept.
    ap.add_argument("--max-usd", type=float, default=4.0)
    args = ap.parse_args()

    dead = []
    for pdf in sorted(EXAMS.rglob("*.pdf")):
        broken, pages = is_dead(pdf)
        if broken:
            dead.append((pdf, pages))

    if args.limit:
        dead = dead[: args.limit]

    total_pages = sum(pages for _, pages in dead)
    print(f"  {len(dead)} paper(s) with an unusable text layer, {total_pages} page(s)")

    if args.estimate:
        # Measured on this corpus at 150 dpi: ~2,500 image tokens in and, for
        # the mini model, ~620 out. Priced at $0.75/M in and $4.50/M out.
        cost = total_pages * (2500 * 0.75 + 620 * 4.5) / 1_000_000
        print(f"  ~${cost:.2f} on {args.model}")
        return

    # $/1M for the model actually being used. Unknown models are priced at the
    # dearest rate on the list rather than free, so an unpriced model cannot
    # spend against a cap it never reaches.
    prices = {
        "gpt-5.4-mini": (0.75, 4.5),
        "gpt-5.4": (2.5, 15.0),
        "gpt-5.5": (5.0, 30.0),
        "claude-sonnet-5": (2.0, 10.0),
    }
    price_in, price_out = prices.get(args.model, (5.0, 30.0))

    done = 0
    spent = 0.0
    for index, (pdf, pages) in enumerate(dead, start=1):
        if spent >= args.max_usd:
            print(
                f"  STOPPED at ${spent:.2f}, the --max-usd limit of "
                f"${args.max_usd:.2f}. {index - 1} of {len(dead)} paper(s) done; "
                f"re-run to continue — pages already read are skipped."
            )
            break
        relative = pdf.relative_to(EXAMS)
        name = slug(relative.with_suffix(""))
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts" / "corpus" / "ocr_pdf.py"),
                "--pdf", str(pdf),
                "--name", name,
                "--model", args.model,
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        ok = result.returncode == 0
        done += ok

        # What this paper actually cost, from the tokens the API reported rather
        # than from the estimate.
        out = result.stdout or ""
        match = re.search(r"tokens: (\d+) in, (\d+) out", out)
        if match:
            spent += (int(match.group(1)) * price_in + int(match.group(2)) * price_out) / 1_000_000

        tail = (out or result.stderr or "").strip().splitlines()
        print(f"  [{index}/{len(dead)}] {'ok ' if ok else 'FAIL'} {relative} ({pages}p)"
              f"  ${spent:.2f}"
              f"{'' if ok else ' — ' + (tail[-1][:80] if tail else '?')}", flush=True)

    print(f"\n  {done}/{len(dead)} paper(s) transcribed into {TEXT}")


if __name__ == "__main__":
    main()
