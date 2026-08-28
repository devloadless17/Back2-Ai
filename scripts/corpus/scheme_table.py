# -*- coding: utf-8 -*-
"""Reads a marking scheme out of the RULED TABLE it is printed in.

    python scripts/corpus/scheme_table.py "corpus/exams/gs/2005 1/gs math_en 1.pdf"

Why geometry rather than a better regex.

`extract_exams.py` reads schemes from flattened text, and for the common layout
that cannot work. A scheme is a three-column table — label, answer, mark — and
flattening it interleaves the columns with the answer's own mathematics. On
gs/2005 1/gs math_en 1.pdf the flattened page gives:

    2b
    →
    HA (1 ; – 2 ; – 1) ;
    ...
    HC(1 ; 1 ; 2) ; HA = HB = HC = 6 .  ½

The label is alone on a line, the answer runs over ten more, and the mark is a
vulgar fraction at the end of the last one. A one-line `label answer mark`
pattern matches none of it.

Widening that pattern is worse than leaving it alone, and this is the part that
matters. Tried on the same page, a line-based reader produced twenty phantom
rows — bare digits shed by broken integrals, read as labels, with exponents
read as their marks — and got two of the five real marks wrong. On a marking
scheme that is not noise: it is an answer key bound to the wrong sub-question,
shown to somebody sitting a national exam.

Read geometrically, the same page gives up all nine rows exactly, because a
mark is a mark by virtue of sitting in the mark COLUMN rather than by looking
like a number. A digit shed by a formula lands in the answer cell and can never
be mistaken for an award. That property comes from the page's own ruling, not
from the care taken writing a pattern, which is why this is the approach worth
having.

What it does NOT do: attach answers. It reports them, and `extract_exams.py`
takes only the marks for now. See `group_to_parts` for why the granularities
differ, and read the barème note in the project memory before changing that.
"""

import re
import sys
from pathlib import Path

import pdfplumber

# "½" is how these papers write a half mark, and no digit pattern reads it.
FRACTIONS = {"½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125}

# A mark cell: "1", "1½", "½", "0.5", "1,5", "2 pts". Anchored to the whole
# cell — a number with prose round it is an answer, not an award.
# The unit may sit either side of the number. An Arabic cell reads "4 علامات",
# and the same cell pulled out of an RTL table arrives as "تاملاع 4" — the words
# mirrored, the digit unchanged. Accepting both orders costs nothing and is what
# lets an Arabic scheme be read at all.
MARK_CELL = re.compile(
    rf"^\s*(?:(\d{{1,2}})\s*)?([{''.join(FRACTIONS)}])\s*(?:pts?|points?)?\s*$"
    rf"|^\s*(?:pts?|points?|علامات?|تاملاع|ناتملاع|ةملاع|نقاط?|طاقن)?\s*"
    rf"(\d{{1,2}}(?:[.,]\d{{1,2}})?)"
    rf"\s*(?:pts?|points?|علامات?|تاملاع|ناتملاع|ةملاع|نقاط?|طاقن)?\s*$"
)

# A label cell: "1", "2a", "3.1", "A3b", "II". Anchored likewise.
# Arabic papers label their parts أ ب ج د ه و rather than a b c d e f, and a
# scheme labelled that way is a scheme. Without them every RTL table fails the
# label-column test even once its columns are the right way round.
AR_LETTERS = "أابجدهوزحط"
LABEL_CELL = re.compile(
    rf"^\s*([A-F]?\s*\d{{1,2}}(?:[.\-]\d{{1,2}})?\s*[a-f]?|[IVX]{{1,4}}|[{AR_LETTERS}])\s*[.)\-]?\s*$",
    re.I,
)

# "Q 1", "Q.2", "Exercice 3", "Question II" — the table saying which exercise
# it marks. These papers print it in the table's own header row.
EXERCISE_CELL = re.compile(
    r"^\s*(?:Q|Qu?estion|Exercice|Exercise|السؤال|التمرين)\s*\.?\s*(\d{1,2}|[IVX]{1,4})\s*$", re.I)

ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10}


def mark_of(cell: str):
    """The award in this cell, or None if the cell is not an award."""
    if not cell:
        return None
    m = MARK_CELL.match(cell.replace("\n", " "))
    if not m:
        return None
    whole, frac, plain = m.groups()
    if frac:
        return (int(whole) if whole else 0) + FRACTIONS[frac]
    try:
        value = float(plain.replace(",", "."))
    except (TypeError, ValueError):
        return None
    # A mark of zero is a page number or a stray digit, not an award; and no
    # sub-question of a paper marked out of twenty is worth more than twenty.
    return value if 0 < value <= 20 else None


def label_of(cell: str):
    """The sub-question label in this cell, folded, or None."""
    if not cell:
        return None
    m = LABEL_CELL.match(cell.replace("\n", " "))
    if not m:
        return None
    text = re.sub(r"\s+", "", m.group(1)).lower()
    # Arabic part letters fold onto the Latin ones so a scheme reads the same
    # whichever alphabet the paper used: أ -> a, ب -> b, ...
    ar = {"أ": "a", "ا": "a", "ب": "b", "ج": "c", "د": "d", "ه": "e", "و": "f", "ز": "g", "ح": "h", "ط": "i"}
    if text in ar:
        return ar[text]
    return ROMAN.get(text, text) and str(ROMAN.get(text, text))


def exercise_of(cell: str):
    """The exercise number this table marks, if the cell announces one."""
    if not cell:
        return None
    m = EXERCISE_CELL.match(cell.replace("\n", " "))
    if not m:
        return None
    raw = m.group(1).lower()
    return ROMAN.get(raw, int(raw) if raw.isdigit() else None)


def _first(cells: list) -> str:
    """The first cell with anything in it."""
    return next((c for c in cells if c), "")


def _last(cells: list) -> str:
    """The last cell with anything in it."""
    return next((c for c in reversed(cells) if c), "")


def _scores(table: list) -> tuple:
    """(rows, label-column hits, mark-column hits) reading left to right.

    Both ends skip empty cells, and the label end did not used to. pdfplumber
    returns a column per ruling line, so a table drawn with a margin rule or a
    merged first column arrives with one or more empty leading cells — the
    Arabic scheme in `corpus/extra` is nine columns wide and carries its part
    label at index 2. Reading `cells[0]` literally scored zero labels on a table
    whose labels were plainly there, and the mark end never had the problem
    because it was already written as "last non-empty".
    """
    rows = labels = marks = 0
    for row in table:
        cells = [(c or "").strip() for c in row]
        if not any(cells):
            continue
        rows += 1
        if label_of(_first(cells)) is not None:
            labels += 1
        if mark_of(_last(cells)) is not None:
            marks += 1
    return rows, labels, marks


def is_rtl_scheme_table(table: list) -> bool:
    """Is this a scheme table whose columns arrived right-to-left?

    An Arabic scheme is ruled السؤال | عناصر الإجابة | العلامة and read from the
    right, so pdfplumber — which walks columns left to right — hands it back
    with the MARK column first and the question column last. `is_scheme_table`
    wants labels first and marks last, so every Arabic scheme in the corpus was
    refused: not mis-read, which would be worse, but never read at all.

    That is almost certainly why every Arabic subject sits at about one
    criterion per question — جغرافيا 1.00 across 8.1 numbered parts, تربية 1.00,
    أدب عربي 1.15 — while Chemistry manages 3.12 and Physics 2.38 off the same
    reader. The marks are printed on the page; nothing could see them.

    Detected rather than assumed from the language: the test is that the table
    reads as a scheme when its columns are reversed and does not when they are
    not. A table that satisfies both readings is ambiguous and is left to the
    left-to-right one.
    """
    rows, labels, marks = _scores([list(reversed(r)) for r in table])
    return rows >= 3 and labels >= rows * 0.5 and marks >= rows * 0.4


def is_scheme_table(table: list) -> bool:
    """A ruled table whose first column is labels and whose last is marks.

    Both tests are about the COLUMN rather than about any one cell, because a
    single number proves nothing on a page of mathematics and a column of them
    down the right-hand edge is what a marking scheme is.
    """
    if len(table) < 3 or max((len(r) for r in table), default=0) < 3:
        return False
    rows, labels, marks = _scores(table)
    return rows >= 3 and labels >= rows * 0.5 and marks >= rows * 0.4


def orient(table: list) -> list:
    """The table with its columns in reading order, whichever way it was laid out."""
    if is_scheme_table(table):
        return table
    if len(table) >= 3 and max((len(r) for r in table), default=0) >= 3 and is_rtl_scheme_table(table):
        return [list(reversed(r)) for r in table]
    return table


def rows_of(table: list) -> list:
    """(label, answer, mark) for each data row of a scheme table."""
    out = []
    for row in table:
        cells = [(c or "").strip() for c in row]
        if not any(cells):
            continue
        label = label_of(_first(cells))
        if label is None:
            continue
        # Same skip-the-blanks rule as the scorer, so a table that PASSES
        # `is_scheme_table` cannot then yield no rows here.
        body = [c for c in cells if c][1:]
        mark = None
        if body and mark_of(body[-1]) is not None:
            mark = mark_of(body[-1])
            body = body[:-1]
        answer = re.sub(r"\s+", " ", " ".join(c for c in body if c)).strip()
        if not answer and mark is None:
            continue
        out.append((label, answer, mark))
    return out


def scheme_from_tables(pdf: Path) -> dict:
    """Read the ruled tables, and say how confident the reading is.

    Returns {"by_exercise": {n: {label: {answer, marks}}}, "attribution": ...,
    "tables": n}.

    `attribution` is the part a caller must not ignore:

      "named"       every table said which exercise it marks ("Q 1"). Trust it.
      "positional"  no table said. They are numbered in the order they appear,
                    which is an ASSUMPTION and is only safe if the caller can
                    check it — the count of scheme tables matching the count of
                    exercises on the paper, and the per-exercise mark ratios
                    agreeing. `extract_exams.py` requires both.

    The split exists because measuring showed it is where the whole yield sits:
    30% of papers have a table this module accepts, and 23 of those 30 points
    name no exercise anywhere. Discarding them — the first version did — threw
    away three quarters of the recoverable schemes. Guessing silently would
    have been worse. Saying which of the two happened lets the caller decide.
    """
    tables: list = []
    try:
        with pdfplumber.open(pdf) as doc:
            for page in doc.pages:
                for table in page.extract_tables():
                    # Put the columns in reading order first: an Arabic scheme
                    # arrives mirrored and would otherwise be refused outright.
                    table = orient(table)
                    if is_scheme_table(table):
                        tables.append(table)
    except Exception:
        # A scheme that cannot be read is a scheme we do not have. Never a
        # reason to lose the paper.
        return {"by_exercise": {}, "attribution": "none", "tables": 0}

    if not tables:
        return {"by_exercise": {}, "attribution": "none", "tables": 0}

    named: list = []
    for table in tables:
        found = None
        for row in table[:2]:
            for cell in row:
                found = exercise_of((cell or "").strip())
                if found:
                    break
            if found:
                break
        named.append(found)

    if any(named):
        attribution = "named"
        # Carried forward: a scheme running over two pages repeats the columns
        # and not always the heading.
        current = None
        keys = []
        for found in named:
            current = found or current
            keys.append(current)
    else:
        attribution = "positional"
        keys = list(range(1, len(tables) + 1))

    scheme: dict = {}
    for key, table in zip(keys, tables):
        if key is None:
            continue
        bucket = scheme.setdefault(key, {})
        for label, answer, mark in rows_of(table):
            if label in bucket:
                bucket[label]["answer"] += " " + answer
                if mark is not None and bucket[label]["marks"] is None:
                    bucket[label]["marks"] = mark
            else:
                bucket[label] = {"answer": answer, "marks": mark}
    return {"by_exercise": scheme, "attribution": attribution, "tables": len(tables)}


def group_to_parts(rows: dict) -> dict:
    """Fold scheme labels onto the granularity the paper is numbered at.

    The two sides do not agree, and pretending they do is how an answer key
    ends up on the wrong question. A scheme writes 2a, 2b, 2c; the paper writes
    one part numbered 2, because `PART` in extract_exams.py reads digits and
    dots and the paper's own "2) a-" carries its letter inside the question
    text. There is no part "2a" to attach a row to.

    So rows are grouped by their leading number and the group is treated as
    what it is — one question's worth of marking, split across three lines of
    the table. The marks SUM, because 1 + ½ + 1 is what part 2 is worth. The
    answers are joined in label order, and are reported rather than stored:
    handing over a third of an answer as the answer would be worse than
    handing over none.
    """
    grouped: dict = {}
    for label in sorted(rows):
        stem = re.match(r"(\d{1,2}(?:\.\d{1,2})?)", label)
        if not stem:
            continue
        key = stem.group(1)
        entry = grouped.setdefault(key, {"answer": "", "marks": None, "parts": []})
        entry["parts"].append(label)
        if rows[label]["answer"]:
            entry["answer"] = (entry["answer"] + " " + rows[label]["answer"]).strip()
        if rows[label]["marks"] is not None:
            entry["marks"] = (entry["marks"] or 0) + rows[label]["marks"]
    return grouped


if __name__ == "__main__":
    target = Path(sys.argv[1])
    read = scheme_from_tables(target)
    scheme = read["by_exercise"]
    if not scheme:
        print("no scheme table found")
        raise SystemExit(0)
    print(f"{read['tables']} scheme table(s); exercises attributed by {read['attribution']}")
    for exercise in sorted(scheme):
        print(f"\nExercise {exercise}")
        for label, row in scheme[exercise].items():
            print(f"  [{label:>4}] {str(row['marks']):>5}  {row['answer'][:70]}")
        print("  grouped to the paper's numbering:")
        for label, row in group_to_parts(scheme[exercise]).items():
            print(f"  [{label:>4}] {str(row['marks']):>5}  from {row['parts']}")
