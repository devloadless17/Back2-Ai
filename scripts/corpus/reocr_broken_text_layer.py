# -*- coding: utf-8 -*-
"""Re-reads the exam papers whose own text layer drops a letter.

    python scripts/corpus/reocr_broken_text_layer.py --list affected.txt --estimate
    python scripts/corpus/reocr_broken_text_layer.py --list affected.txt --max-usd 2.20

WHAT IS WRONG WITH THESE PAPERS. Their embedded text layer maps "s" to a space,
so "Consider two urns" extracts as "Con ider two urn " and "this apparatus" as
"thi apparatu ". 168 questions across 113 papers, 37% of GS Physics. Unlike the
reversed-mathematics problem — where a clean transcription already sat in
`content_latex` and the fix was free — this corruption is in BOTH columns. There
is no clean copy to read, so the page has to be read again.

Text like this is worse than no text. It looks readable, it embeds without
complaint, and it retrieves and answers as though it were fine.

WHY THE CHEAP MODEL. Measured on this corpus, one physics page and one maths
page through both:

    prose and inline notation   identical output; √(m/k) and P(B∩F) both intact
    tables                      gpt-5.5 keeps the columns, mini flattens them

The corruption being fixed is a missing letter, and both models fix it equally.
So the default is the cheap model at a tenth of the price, and pages whose
layout matters are a second, smaller pass — see --model. Flattening a table is a
real loss: the probability question on GS Mathematics 2004 is answered FROM its
table, and a flattened one no longer says which price belongs to which country.

A HARD SPEND CEILING, because `ocr_pdf.py` caps nothing across a batch and a
list of 113 papers is roughly 450 pages. Checked after every file against the
tokens that file actually reported, never against an estimate: an estimate made
before the work is a guess about a distribution nobody has seen.

Resumable. `ocr_pdf.py` skips a page already on disk, so an interrupted run
costs nothing to restart.
"""

import argparse
import pathlib
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXAMS = ROOT / "corpus" / "exams"

# Per million tokens. Check against the provider's current price list before a
# large run; these are what the figures below are computed from.
PRICES = {
    "gpt-5.4-mini": (0.75, 4.50),
    "gpt-5.5": (5.00, 30.00),
}

# The word in a filename for each subject. Papers are named inconsistently —
# "2004 gs physics_en 1.pdf", "gs physics_en 1.pdf", "physics_en.pdf" — but the
# subject word and the language suffix are always in there.
SUBJECT_WORD = {
    # STEMS, not full names. The same subject is abbreviated differently from
    # folder to folder — "2004 gs physics_en 1.pdf" in one year and "phy_en.pdf"
    # in another — and matching on "physics" silently skipped every folder that
    # used the short form. That looked like 66 papers missing from the corpus
    # when most of them were sitting there under another name.
    "physics": "phy",
    "mathematics": "math",
    "chemistry": "chem",
    "english": "eng",
    "life sciences": "bio",
}


# Accommodation papers — sat by candidates with a disability, under a different
# and shorter specification. They are not the paper a student is revising for and
# they are excluded from this corpus everywhere else; a re-OCR run that quietly
# pulled them back in would undo that.
ACCOMMODATION = ("ehteyejet", "ehtiyejet", "makfufin", "makfoufen", "mu5tasa", "mokhtasa")

# Not a question paper.
NOT_A_PAPER = ("_sol", "solution", "bareme", "bar_me")


def find_pdf(track: str, year: str, session: str, subject: str) -> pathlib.Path | None:
    """The English-edition question paper, or None if it is not on disk."""
    folder = EXAMS / track / f"{year} {session}"
    if not folder.is_dir():
        return None

    word = SUBJECT_WORD.get(subject)
    if not word:
        return None

    candidates = []
    for pdf in sorted(folder.glob("*.pdf")):
        name = pdf.name.lower()
        if word not in name:
            continue
        if any(bad in name for bad in ACCOMMODATION):
            continue
        if any(bad in name for bad in NOT_A_PAPER):
            continue
        # Not the French or Arabic edition — this corruption is in the English
        # papers, and the other editions are separate rows with their own text.
        if "_fr" in name or " fr " in name or "_ar" in name:
            continue
        candidates.append(pdf)

    if not candidates:
        return None
    # Prefer an explicit _en edition when the folder holds several.
    for pdf in candidates:
        if "_en" in pdf.name.lower() or " en " in pdf.name.lower():
            return pdf
    return candidates[0]


def cost(model: str, tokens_in: int, tokens_out: int) -> float:
    rate_in, rate_out = PRICES.get(model, PRICES["gpt-5.5"])
    return tokens_in * rate_in / 1_000_000 + tokens_out * rate_out / 1_000_000


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", required=True, help="pipe-separated: track|year|session|subject|count")
    ap.add_argument("--model", default="gpt-5.4-mini")
    ap.add_argument("--max-usd", type=float, default=2.20)
    ap.add_argument("--estimate", action="store_true")
    args = ap.parse_args()

    listing = pathlib.Path(args.list)
    if not listing.is_absolute():
        listing = ROOT / listing
    rows = [l.strip() for l in listing.read_text(encoding="utf-8").splitlines() if l.strip()]

    jobs = []
    missing = []
    for row in rows:
        parts = row.split("|")
        if len(parts) < 4:
            continue
        track, year, session, subject = parts[0], parts[1], parts[2], parts[3]
        pdf = find_pdf(track, year, session, subject)
        if pdf is None:
            missing.append(f"{track} {year}/{session} {subject}")
        else:
            jobs.append((f"{track}-{year}-{session}-{subject}".replace(" ", "-"), pdf))

    # Same PDF can back several papers; read it once.
    seen = set()
    unique = []
    for name, pdf in jobs:
        if pdf in seen:
            continue
        seen.add(pdf)
        unique.append((name, pdf))

    print("")
    print(f"  {len(rows)} papers listed, {len(unique)} PDFs found, {len(missing)} not on disk")
    if missing[:5]:
        print("  not found: " + "; ".join(missing[:5]) + (" …" if len(missing) > 5 else ""))
    print(f"  model {args.model}, ceiling ${args.max_usd:.2f}")
    print("")

    if args.estimate:
        print("  --estimate: nothing read, nothing spent.")
        return

    spent = 0.0
    done = 0
    for name, pdf in unique:
        if spent >= args.max_usd:
            print(f"\n  STOPPED at ${spent:.4f}, ceiling ${args.max_usd:.2f}.")
            print(f"  {done} of {len(unique)} PDFs read. Re-run to continue — pages already read are skipped.")
            break

        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "corpus" / "ocr_pdf.py"),
             "--pdf", str(pdf), "--name", f"reocr-{name}", "--model", args.model],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        out = (result.stdout or "") + (result.stderr or "")
        match = re.search(r"tokens:\s*(\d+)\s*in,\s*(\d+)\s*out", out)
        if match:
            page_cost = cost(args.model, int(match.group(1)), int(match.group(2)))
            spent += page_cost
            done += 1
            print(f"  ${spent:7.4f}  {pdf.relative_to(EXAMS)}")
        elif "0 page" in out or "still to read" in out:
            done += 1  # already on disk from an earlier run
        else:
            print(f"  FAILED    {pdf.relative_to(EXAMS)}")
            if result.returncode != 0:
                print("    " + out.strip().splitlines()[-1][:120] if out.strip() else "")

    print(f"\n  spent ${spent:.4f} on {done} PDF(s).\n")


if __name__ == "__main__":
    main()
