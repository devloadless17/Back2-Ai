# -*- coding: utf-8 -*-
"""Reads the fractions off a PDF page and writes them back as LaTeX.

    python scripts/corpus/fraction-bars.py "<pdf>" <page>

Prints the page's text with every fraction it finds replaced by $\\frac{a}{b}$,
and nothing else, so the caller can use it exactly where it used
`pdftotext -layout`.

Why this is possible at all: a fraction in these papers is not markup. It is a
numerator placed above a denominator with a horizontal rule drawn between them,
and every text extractor flattens it — poppler emits the numerator on one line
and the denominator on the next, which is how "α = 10⁻ᵖᴴ/C" reaches a student as

    2- Establish the following relation: α = 10− pH where α represents
    C dissociation of chloroacetic acid in water.

The rule is still in the file though. `pdfplumber` exposes the drawn lines as
well as the words, so the bar can be found by geometry and the two operands read
off it. On the chemistry page there is exactly one short rule — 29pt wide at
y=253 — and it is the fraction.

Two things separate a fraction bar from every other rule on the page:

    WIDTH. Heading underlines on the same page are 178pt, 345pt and 182pt. A
    fraction bar is as wide as its widest operand, which for exam algebra is
    rarely past 90pt. Anything wider is prose furniture.

    OPERANDS. There must be text both above and below it, inside its own x-span.
    An underline has words above it and the next paragraph well below; the
    vertical window here is tight enough to exclude that.

A rule failing either test is left alone. The cost of a false positive is a
sentence turned into a fraction, which is worse than the flattening it replaces,
so the tests are deliberately narrow — this finds the clear cases and leaves
anything ambiguous as it was.
"""
import re
import subprocess
import sys

import pdfplumber

# A fraction bar is as wide as its widest operand. Heading underlines on these
# papers start at 178pt, so 95 leaves room for a long numerator and no overlap
# with prose furniture.
MAX_BAR_WIDTH = 95
# How far above and below the bar an operand may sit. Roughly one line of exam
# body text; wider starts catching the sentence under a heading underline.
OPERAND_WINDOW = 15
# Below this a "bar" is a tick, a bullet or part of a glyph.
MIN_BAR_WIDTH = 6


def is_horizontal(obj):
    return abs(obj["y0"] - obj["y1"]) < 1.5


def bars(page):
    """Every drawn rule that could be a fraction bar."""
    found = []
    for obj in list(page.lines) + list(page.rects):
        if not is_horizontal(obj):
            continue
        width = obj["x1"] - obj["x0"]
        if not (MIN_BAR_WIDTH <= width <= MAX_BAR_WIDTH):
            continue
        found.append({"x0": obj["x0"], "x1": obj["x1"], "y": obj["top"]})
    return found


def operands(words, bar):
    """The words sitting directly above and below one bar."""
    above, below = [], []
    for w in words:
        # Horizontal overlap with the bar, with a little tolerance for the
        # italic overhang common on single-letter operands.
        if w["x1"] < bar["x0"] - 4 or w["x0"] > bar["x1"] + 4:
            continue
        if 0 <= bar["y"] - w["bottom"] <= OPERAND_WINDOW:
            above.append(w)
        elif 0 <= w["top"] - bar["y"] <= OPERAND_WINDOW:
            below.append(w)
    above.sort(key=lambda w: w["x0"])
    below.sort(key=lambda w: w["x0"])
    return (
        " ".join(w["text"] for w in above).strip(),
        " ".join(w["text"] for w in below).strip(),
    )


# Function names and units that legitimately appear inside a fraction. Anything
# else with four or more letters in a row is prose.
MATHS_WORDS = {
    "ln", "log", "sin", "cos", "tan", "exp", "lim", "max", "min", "sup", "inf",
    "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "det", "mod",
    "ph", "pka", "pkb", "dx", "dt", "dv", "dm", "dq", "du", "dy", "dn",
    "mol", "mmol", "kg", "cm", "mm", "km", "ms", "hz", "mev", "ev", "rad",
}


def looks_like_maths(operand):
    """Whether an operand is a formula rather than a table cell.

    The width and operand tests alone accept far too much: a bordered table puts
    a rule under every cell, so "Answers" over "b" and "number" over "Q" arrive
    looking exactly like a fraction. Splicing those replaces a sentence with a
    formula, which is a worse fault than the flattening being fixed — the
    student cannot tell that the text was ever different.

    A word of four or more letters is the tell. Exam algebra uses single letters,
    digits and a short list of function names; prose does not.
    """
    for word in re.findall(r"[A-Za-z]{4,}", operand):
        if word.lower() not in MATHS_WORDS:
            return False
    return True


def latexify(text):
    """Minimal cleanup so an operand reads as maths rather than as characters."""
    text = text.replace("−", "-").replace("–", "-")
    # A superscript that poppler flattened, e.g. "10-pH" for 10 to the -pH.
    text = re.sub(r"(\d)\s*-\s*([A-Za-zα-ω]+)", r"\1^{-\2}", text)
    return text.strip()


def loose(s):
    """A pattern matching these characters however the reader spaced them.

    The two readers disagree about spacing on the same glyphs: pdfplumber gives
    "10−pH", poppler's layout gives "10− pH". Matching literally finds nothing
    and the fraction stays flattened with no sign that anything was attempted.
    """
    return r"\s*".join(re.escape(c) for c in s if not c.isspace())


def maths_spans(text):
    """Character ranges already inside a `$…$` pair."""
    return [(m.start(), m.end()) for m in re.finditer(r"\$[^$]*\$", text)]


def first_match_outside_maths(pattern, text):
    """The first match that does not touch an existing formula.

    WHY THIS EXISTS. `main` splices each fraction in turn, and every splice
    searches text that earlier splices have already changed. Nothing stopped a
    later numerator from matching INSIDE a `$\\frac{…}$` written moments before,
    and the corpus holds the result:

        $\\frac{2$\\frac{9}{56}$}{56}$

    KaTeX cannot parse that. `rehype-katex` renders an unparseable span in red,
    inline, so a student is shown the raw source of a formula where the formula
    should be — 240 such spans across Physics and Mathematiques, 7.2% of all the
    mathematics in the corpus.

    I could not reproduce the exact page geometry that produces it, so this is a
    guard rather than a repair of a specific path: a fraction is written only
    where no formula already stands. That is true regardless of which sequence
    of splices got there, and it cannot make a page worse — the alternative to
    writing a nested fraction is leaving the text flat, which is the state this
    whole script is an improvement on.

    Existing rows are NOT repaired by this. Stripping the inner delimiters of
    one that is already stored would make it parse and render a clean-looking
    formula that may be mathematically wrong, which is worse than one that is
    visibly broken. `npm run check:math-rendering` counts what remains.
    """
    spans = maths_spans(text)
    for match in re.finditer(pattern, text):
        if any(start < match.end() and match.start() < end for start, end in spans):
            continue
        return match
    return None


def splice(text, num, den):
    """Put one fraction back into the flattened text.

    The two halves are not adjacent. Poppler emits the numerator inline, in the
    middle of the sentence it belongs to, and drops the denominator onto the
    next line indented underneath it:

        relation: α = 10− pH where α represents the degree of
                     C   dissociation of chloroacetic acid in water.

    So this is two edits, not one substitution: write the fraction where the
    numerator stands, then take out the orphan below. The orphan is only removed
    when it appears as a whole token on one of the next two lines — a bare "C"
    is a common letter, and deleting the wrong one silently corrupts a sentence
    to fix a formula.

    If either half cannot be placed, the text is returned untouched. A fraction
    left flat is a known problem; a mangled sentence is a new one.
    """
    match = first_match_outside_maths(loose(num), text)
    if not match:
        return text

    replacement = "$\\frac{%s}{%s}$" % (latexify(num), latexify(den))
    head, tail = text[: match.start()], text[match.end() :]

    # The orphan sits on one of the next couple of lines. Only a standalone
    # occurrence counts, and only the first.
    lines = tail.split("\n")
    for i, line in enumerate(lines[:3]):
        stripped = re.sub(r"^\s*%s(?=\s|$)" % loose(den), "", line, count=1)
        if stripped != line:
            lines[i] = stripped
            return head + replacement + "\n".join(lines)

    return text


def main():
    if len(sys.argv) < 3:
        sys.stderr.write("usage: fractions.py <pdf> <page>\n")
        raise SystemExit(2)

    path, page_no = sys.argv[1], int(sys.argv[2])
    with pdfplumber.open(path) as pdf:
        if page_no < 1 or page_no > len(pdf.pages):
            raise SystemExit(2)
        page = pdf.pages[page_no - 1]
        words = page.extract_words()

        # The text comes from poppler, not pdfplumber: it is the exact output
        # the Node pipeline already stores, so this stays a splice rather than a
        # second, subtly different reading of the page. pdfplumber is here for
        # the geometry, which poppler does not expose.
        text = subprocess.run(
            ["pdftotext", "-layout", "-enc", "UTF-8",
             "-f", str(page_no), "-l", str(page_no), path, "-"],
            capture_output=True, check=False,
        ).stdout.decode("utf-8", "replace")

        found = []
        for bar in bars(page):
            num, den = operands(words, bar)
            if not num or not den:
                continue
            # An operand that is a whole sentence is a paragraph under a rule,
            # not a fraction. Real ones are short.
            if len(num) > 40 or len(den) > 40:
                continue
            if not looks_like_maths(num) or not looks_like_maths(den):
                continue
            found.append({"num": num, "den": den})

        # Splice each one back where poppler left it flattened: numerator at the
        # end of a line, denominator at the start of the next. `count=1` so two
        # identical fractions on a page are replaced one each rather than twice.
        for f in found:
            text = splice(text, f["num"], f["den"])

    # Bytes, not str: Python defaults stdout to the console codepage on Windows,
    # which is cp1252 here and cannot encode ⇄ or α — the very characters this
    # exists to preserve. Writing UTF-8 to the buffer makes the output the same
    # on every machine, whatever the console can display.
    sys.stdout.buffer.write(text.encode("utf-8"))


if __name__ == "__main__":
    main()
