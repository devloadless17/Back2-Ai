# -*- coding: utf-8 -*-
"""Re-reads the papers whose text layer mis-maps the Arabic-Indic digits.

    python scripts/corpus/reocr_broken_digits.py --estimate
    python scripts/corpus/reocr_broken_digits.py --max-usd 3.00

WHICH PAPERS. `broken_digits.py` decides, by proving a paper cites a document
number that cannot exist. Thirty papers, deduplicated by sha256 because the same
PDF is filed under two tracks, with the accommodation editions excluded.

WHY THEY CANNOT BE REPAIRED IN PLACE. Their fonts are `/Identity-H` with no
embedded font file, so the PDF's own `/ToUnicode` map is the only thing that
says what a glyph means, and for the digits it lies. pypdf, pdfplumber and
pypdfium2 all return the same wrong digit because they are all reading that same
map. With no glyph program there is nothing to fall back on.

WHY THE CHEAP MODEL. This is the reasoning in `reocr_broken_text_layer.py`,
which measured both models on this corpus: identical on prose and inline
notation, and `gpt-5.5` only wins on tables, which it keeps and the mini model
flattens. What is being recovered here is a digit inside a caption or a
sentence — "المستند رقم (١)" — so the mini model is the default. Papers whose
documents ARE tables deserve a second pass; `--model` is there for that.

A HARD SPEND CEILING, checked after every paper against the tokens that paper
actually reported, never against an estimate. An estimate made before the work
is a guess about a distribution nobody has seen.

Resumable. `ocr_pdf.py` skips a page already on disk, so an interrupted run
costs nothing to restart.

AFTER THIS RUNS the transcription is on disk but nothing uses it yet. Re-extract
(`npm run corpus:extract-exams`), diff against a snapshot taken beforehand
(`compare_extract.py --against ...`), then re-run the C1/C2/C3 passes and
`npm run corpus:visuals` so the recovered document numbers reach the figures.
"""

import argparse
import pathlib
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXAMS = ROOT / "corpus" / "exams"

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from broken_digits import papers  # noqa: E402

# Per million tokens. Check against the provider's current price list before a
# large run; these are what the figures below are computed from.
PRICES = {
    "gpt-5.4-mini": (0.75, 4.50),
    "gpt-5.5": (5.00, 30.00),
}

# Two shapes, because `ocr_pdf.py` reports differently in its two modes and the
# first version of this file only knew the estimate one. A real run then priced
# every paper at $0.00 and the ceiling below never fired — it was decoration.
# The ceiling is the only thing standing between a long list and an unbounded
# bill, so it is parsed from what the run actually prints, and a paper whose
# cost cannot be read is treated as the estimate rather than as free.
_ESTIMATE = re.compile(r"~([\d.]+)k input tokens, ~([\d.]+)k output tokens")
_ACTUAL = re.compile(r"tokens:\s*(\d+)\s*in,\s*(\d+)\s*out")


def folder_name(path: str) -> str:
    """A readable folder stem: `lh-2016-2-geo`. The sha suffix is added by
    `ocr_pdf.py`, and is what makes the pages findable again."""
    clean = path.replace("\\", "/").removesuffix(".pdf")
    return re.sub(r"[^a-z0-9]+", "-", clean.lower()).strip("-")


def cost(text: str, model: str, pages: int) -> float:
    """What this paper cost, from the tokens it reported.

    A paper that reported nothing — it errored, or every page was already on
    disk — is priced at the per-page estimate rather than at zero, so an
    unreadable report can only make the ceiling fire EARLY. Pricing it at zero
    is what made the ceiling inert the first time.
    """
    pin, pout = PRICES[model]
    m = _ACTUAL.search(text)
    if m:
        tin, tout = float(m.group(1)), float(m.group(2))
    else:
        m = _ESTIMATE.search(text)
        if m:
            tin, tout = float(m.group(1)) * 1000, float(m.group(2)) * 1000
        elif "still to read" in text or "page(s) read" in text:
            return 0.0  # nothing left to do; every page was already on disk
        else:
            tin, tout = pages * 1100, pages * 1500  # ocr_pdf.py's own per-page figures
    return tin * pin / 1e6 + tout * pout / 1e6


def run(pdf: pathlib.Path, name: str, model: str, estimate: bool) -> str:
    cmd = [sys.executable, str(ROOT / "scripts" / "corpus" / "ocr_pdf.py"),
           "--pdf", str(pdf), "--name", name, "--model", model]
    if estimate:
        cmd.append("--estimate")
    out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    return (out.stdout or "") + (out.stderr or "")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--estimate", action="store_true", help="print the bill, write nothing")
    ap.add_argument("--max-usd", type=float, default=0.0, help="stop once this much has been spent")
    ap.add_argument("--model", default="gpt-5.4-mini", choices=sorted(PRICES))
    args = ap.parse_args()

    if not args.estimate and args.max_usd <= 0:
        sys.exit("refusing to spend without --max-usd; run --estimate first")

    todo = papers()
    spent = 0.0
    print(f"{len(todo)} paper(s), model {args.model}"
          + (f", ceiling ${args.max_usd:.2f}" if not args.estimate else " (estimate only)"))

    for i, exam in enumerate(todo, 1):
        rel = exam["path"].replace("\\", "/")
        pdf = EXAMS / rel
        if not pdf.is_file():
            print(f"  [{i:>2}/{len(todo)}] MISSING {rel}")
            continue

        text = run(pdf, folder_name(rel), args.model, args.estimate)
        paid = cost(text, args.model, exam.get("pages") or 0)
        spent += paid
        head = next((ln for ln in text.splitlines()
                     if "still to read" in ln or "read into" in ln), text.strip()[:60])
        print(f"  [{i:>2}/{len(todo)}] {rel:<34} {head.strip():<34} ${paid:.3f}  (total ${spent:.2f})")
        for ln in text.splitlines():
            if "CHECK these pages" in ln or "error" in ln.lower():
                print(f"        {ln.strip()}")

        if not args.estimate and args.max_usd and spent >= args.max_usd:
            print(f"\nSTOPPED at the ${args.max_usd:.2f} ceiling after {i} paper(s). "
                  f"Re-run to continue — pages already read are skipped.")
            return

    print(f"\n{'estimated' if args.estimate else 'spent'}: ${spent:.2f}")


if __name__ == "__main__":
    main()
