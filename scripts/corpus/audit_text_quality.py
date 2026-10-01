"""
Watches the stored French and English text for damage, without reading French.

    python scripts/corpus/audit_text_quality.py --questions <in.json> --cache <pdf-index.pkl>

WHY A LEXICON AND NOT A RULE. Three attempts at this failed before it worked.
Counting letters against French averages accused every maths question, because
equations are symbol-heavy and every letter looks scarce. Taking s as a share of
e accused chemistry, because LaTeX and accents inflate e. Hunting for strings
that cannot occur in French found real damage but only the shapes I happened to
think of. All three produced confident numbers that were wrong.

THE PAPERS THEMSELVES ARE THE DICTIONARY. The PDF text layers are intact — that
was established when the passages were rebuilt from them — so every word that
appears in them is a word these exams really use, in this spelling, including
the proper nouns and the technical vocabulary a general dictionary would reject.
A token in the database that appears nowhere in two thousand papers is damaged.

WHAT IT CANNOT SEE. A word broken into two real words ("de" + "venir") is
invisible to it, and so is a wrong word that happens to be spelt correctly. It
measures damage, not correctness.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import pickle
import re
import sys
from collections import Counter

import pypdfium2 as pdfium

sys.stdout.reconfigure(encoding="utf-8")

# THE APOSTROPHE IS PART OF THE WORD IN FRENCH. Splitting on it turns every
# elision — l'habitude, d'une, qu'il — into a stray single letter, and the first
# version of this flagged those as damage. It scored a rebuilt passage as badly
# as the broken one it replaced, which is how the mistake showed.
WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*", re.UNICODE)
ARABIC = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")
LATIN = re.compile(r"[A-Za-zÀ-ÿ]")

# A word must appear this often across the archive to count as real, so a
# damaged paper cannot teach its own damage to the lexicon.
MIN_SIGHTINGS = 2
# Short tokens are mostly fragments; these are the real French and English ones.
REAL_SHORT = {
    "a", "à", "y", "en", "le", "la", "de", "du", "un", "on", "il", "ne", "se", "ce", "et", "ou",
    "où", "au", "si", "me", "te", "sa", "ma", "ta", "tu", "je", "ni", "ès", "an", "as", "ai", "es",
    "nu", "or", "os", "va", "vu", "su", "dû", "là", "ça", "eu", "ce", "si",
    "i", "o", "is", "it", "in", "to", "of", "by", "at", "be", "as", "we", "he", "do", "so", "no",
    "up", "an", "if", "my", "us", "me", "on", "or",
}


# LATEX IS NOT PROSE AND MUST NOT BE READ AS IT. A command such as mathrm,
# frac, sqrt or rightarrow appears nowhere in a printed paper text layer, so
# the lexicon rejects every one of them and a correct equation scored 49%
# damaged. The worst bodies in the first full run were all simply mathematics.
LATEX_COMMAND = re.compile(r"\\[A-Za-z]+")
LATEX_NOISE = re.compile(r"[${}^_\\&~]")


def strip_latex(text: str) -> str:
    return LATEX_NOISE.sub(" ", LATEX_COMMAND.sub(" ", text or ""))


def tokens(text: str) -> list[str]:
    return [t.lower() for t in WORD.findall(strip_latex(text))]


def build_lexicon(root: str, cache: str) -> set[str]:
    index_cache = cache
    if index_cache and os.path.exists(index_cache):
        with open(index_cache, "rb") as fh:
            index = pickle.load(fh)
    else:
        index = {}
        for n, path in enumerate(sorted(glob.glob(os.path.join(root, "**", "*.pdf"), recursive=True)), 1):
            try:
                doc = pdfium.PdfDocument(path)
                index[path] = "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))
            except Exception:
                continue
            if n % 400 == 0:
                print(f"  read {n} papers", flush=True)
        if index_cache:
            with open(index_cache, "wb") as fh:
                pickle.dump(index, fh)

    seen: Counter[str] = Counter()
    for text in index.values():
        seen.update(t for t in tokens(text) if len(t) >= 2)
    return {w for w, n in seen.items() if n >= MIN_SIGHTINGS}


def damage(text: str, lexicon: set[str]) -> dict:
    """What looks wrong in one body of text."""
    ts = [t for t in tokens(text) if LATIN.search(t)]
    if not ts:
        return {"words": 0, "unknown": 0, "rate": 0.0, "examples": [], "arabic_lines": 0}

    """
    A SPLIT WORD IS WHAT WE ARE LOOKING FOR, NOT AN UNFAMILIAR ONE.

    Counting tokens the lexicon does not know flagged `toothpaste`,
    `thermoplastiques` and `drosophiles` — correct words that are merely rare, or
    that come from a paper this archive does not hold. That measures how much of
    the vocabulary I have seen, not how damaged the text is.

    A word pulled apart leaves a signature nothing else does: the two halves put
    back together make a word the archive knows. "condit ion" rejoins into
    "condition", "d u" into "du", "nou s" into "nous". Requiring at least one
    half to be unknown on its own keeps real pairs like "de venir" out of it.
    """
    joined = 0
    examples_found: list[str] = []
    for first, second in zip(ts, ts[1:]):
        # A SINGLE LETTER IS A VARIABLE, NOT HALF A WORD. Allowing them made
        # every maths body look ruined — "of f" rejoins into "off", "is a" into
        # "isa", "lim x" into "limx", and none of those is damage. Both halves
        # must be at least two letters, and the word they make at least five, or
        # the coincidences outnumber the real splits.
        if len(first) < 2 or len(second) < 2:
            continue
        pair = first + second
        if len(pair) < 5:
            continue
        if pair in lexicon and (first not in lexicon or second not in lexicon):
            joined += 1
            if len(examples_found) < 6:
                examples_found.append(f"{first} {second}->{pair}")
    unknown = [""] * joined
    strays: list[str] = []

    arabic_lines = 0
    for line in (text or "").split("\n"):
        if ARABIC.search(line) and LATIN.search(line):
            arabic_lines += 1

    bad = unknown + strays
    return {
        "words": len(ts),
        "unknown": len(bad),
        "rate": len(bad) / len(ts),
        "examples": examples_found,
        "arabic_lines": arabic_lines,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--questions", required=True, help="[{id, subject, body}]")
    ap.add_argument("--out", default="")
    ap.add_argument("--papers", default="corpus/exams")
    ap.add_argument("--cache", default="")
    ap.add_argument("--min-words", type=int, default=40)
    ap.add_argument("--flag-above", type=float, default=0.08)
    args = ap.parse_args()

    lexicon = build_lexicon(args.papers, args.cache)
    print(f"lexicon: {len(lexicon)} words seen {MIN_SIGHTINGS}+ times across the archive")

    rows = json.load(open(args.questions, encoding="utf-8"))
    report = []
    for row in rows:
        d = damage(row.get("body") or "", lexicon)
        if d["words"] < args.min_words:
            continue
        report.append({**{k: row.get(k) for k in ("id", "subject")}, **d})

    flagged = [r for r in report if r["rate"] > args.flag_above or r["arabic_lines"]]
    print(f"bodies measured: {len(report)} | flagged: {len(flagged)}")
    by: dict[str, int] = {}
    for r in flagged:
        by[r["subject"]] = by.get(r["subject"], 0) + 1
    for subject, n in sorted(by.items(), key=lambda kv: -kv[1]):
        print(f"  {str(n).rjust(5)}  {subject}")

    worst = sorted(flagged, key=lambda r: -r["rate"])[:8]
    print("")
    print("worst bodies:")
    for r in worst:
        print(f"  {r['rate']:.0%} damaged, {r['arabic_lines']} mixed line(s)  [{r['subject']}]  {r['examples']}")

    if args.out:
        json.dump(report, open(args.out, "w", encoding="utf-8"), indent=1)
        print(f"-> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
