# -*- coding: utf-8 -*-
"""Where on the printed page did each already-extracted exercise come from?

    python scripts/corpus/position_structure.py --limit 40
    python scripts/corpus/position_structure.py            # whole corpus
    python scripts/corpus/position_structure.py --show "gs/2021 2/SG_Phys_2021_2_En.pdf"

THIS DOES NOT EXTRACT ANYTHING. `extract_exams.py` remains the sole authority on
what an exercise is; this reads its output and asks only where on the source
that object was printed. Nothing here can create, merge, split or rename an
academic object, and if alignment fails the answer is "unresolved", never a
different segmentation.

WHY TITLE MATCHING WAS NOT ENOUGH. Locating an exercise by looking for its
extracted title among the OCR lines found 215 of 408 — 53%. The title is a
*derived* string: normalised, sometimes assembled across a line break,
sometimes taken from a statement fragment. The printed heading is raw. They
agree about half the time, and half is not a foundation for deciding which
question a diagram belongs to.

WHAT THIS DOES INSTEAD. The extractor built each exercise out of text that came,
ultimately, from these same lines. So the problem is sequence alignment, not
search: take the first meaningful tokens of the exercise's own body, find where
that run of tokens occurs in the positioned token stream, and require the
exercises to land in the order the extractor already says they are in. Document
order is the strongest constraint available and title equality never used it.

SPANS ARE PAGE-LOCAL. An exercise that runs across a page break is recorded as
one segment per page — page 4 from y=620 to the bottom, page 5 from the top to
y=410 — rather than as a single rectangle that would claim the margins of both.
A figure on a continuation page has to be able to fall inside it.
"""
import argparse
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[2]
EXAMS_JSON = ROOT / "corpus" / "exams.json"
META = ROOT / "corpus" / "meta"
OUT_DIR = ROOT / "corpus" / ".mapping"
OUT_FILE = OUT_DIR / "positioned-structure.json"

# --------------------------------------------------------------------------
# Normalisation
#
# Matched on FOLDED text, because the two sides were produced by different
# readers. `foldArabic` in the application does the same job for embeddings and
# for the same reason: a PDF emits Arabic presentation forms that share no code
# point with the letters a keyboard produces, so comparing them raw compares
# encodings rather than words.
# --------------------------------------------------------------------------
_DIACRITICS = re.compile("[ً-ْٰ]")
_TATWEEL = "ـ"


def fold(text: str) -> str:
    t = unicodedata.normalize("NFKC", str(text))
    t = t.replace(_TATWEEL, "")
    # The canonical Geography text — the PDF's own text layer — writes heh as
    # U+06BE (415 times) where Mathpix prints ه, and puts a space before a
    # combining mark ("حد ِّد" for "حدِّد"). Both are encoding, not words.
    t = t.replace("ھ", "ه")
    t = re.sub(r"\s+(?=[ً-ْٰ])", "", t)
    t = _DIACRITICS.sub("", t)
    t = re.sub("[أإآٱ]", "ا", t)   # alef variants
    t = t.replace("ى", "ي").replace("ة", "ه")
    return t.lower()


# Tokens worth aligning on. Punctuation and LaTeX plumbing are dropped: they are
# the parts most likely to differ between the extractor's copy and the OCR line.
#
# WORDS ONLY — letters, three or more. The two sides render formulas
# differently: the canonical text comes from the PDF's text layer, where
# "x y' - y = 1 - 2 ln x" arrives as "( ) : ' 1 2 ln−= −I xy y x"; the positioned
# lines come from Mathpix, where it is LaTeX inside $…$ and stripped here. The
# digits and one- and two-letter fragments that survive on the canonical side
# have no counterpart on the other, and a Maths probe was often half formula
# debris — 116 correctly placed Maths exercises scored below 0.60 for it.
# Prose words agree on both sides. Short function words (a, de, في) go too;
# they occur everywhere, so they never helped tell one position from another.
_TOKEN = re.compile(r"[^\W\d_]{3,}", re.UNICODE)


def tokens(text: str) -> list:
    t = fold(text)
    t = re.sub(r"\\[a-zA-Z]+", " ", t)          # \section, \begin, \frac …
    t = re.sub(r"!\[\]\([^)]*\)", " ", t)       # image references
    t = re.sub(r"\$[^$]*\$", " ", t)            # inline maths
    return _TOKEN.findall(t)


# --------------------------------------------------------------------------
# The positioned token stream
# --------------------------------------------------------------------------
def token_stream(lines_json: dict) -> list:
    """Every token on the paper, in printed order, carrying where it sits.

    One entry per token: (token, page, y_top, y_bottom, line_index). The line
    index is kept so an aligned span can name the source lines it came from
    rather than only a coordinate.
    """
    stream = []
    line_index = 0
    for page in lines_json.get("pages", []):
        page_no = page.get("page")
        for ln in page.get("lines", []):
            region = ln.get("region") or {}
            y = region.get("top_left_y")
            h = region.get("height") or 0
            text = str(ln.get("text") or "")
            for tok in tokens(text):
                stream.append((tok, page_no, y, (y + h) if y is not None else None, line_index))
            line_index += 1
    return stream


def page_bounds(lines_json: dict) -> dict:
    return {
        p.get("page"): (p.get("page_height"), p.get("page_width"))
        for p in lines_json.get("pages", [])
    }


# --------------------------------------------------------------------------
# Alignment
# --------------------------------------------------------------------------
PROBE_LEN = 14          # tokens taken from the head of an exercise
MIN_PROBE = 5           # below this there is not enough to align on
WINDOW_SLACK = 3        # tokens OCR may insert between two matched probe tokens


def probes_for(exercise: dict) -> list:
    """The ways this exercise's head might appear in print, most specific first.

    TWO PROBES, because the first token of a probe must sit exactly at the
    anchor. A title-first probe is the right one when the heading was printed —
    it anchors on the heading line itself. But when the extracted title was
    never printed as such (derived, normalised, assembled from a fragment), its
    first word occurs nowhere on the page and the whole probe scores zero. The
    statement is raw on both sides, so it is the fallback.

    Returned as (kind, tokens). An empty title yields a single statement probe:
    there the statement IS the head, not a fallback for it.
    """
    title = tokens(exercise.get("title") or "")
    body = tokens(exercise.get("statement") or "")
    out = []
    if title:
        out.append(("heading", (title + body)[:PROBE_LEN]))
        out.append(("body-fallback", body[:PROBE_LEN]))
    else:
        out.append(("body", body[:PROBE_LEN]))
    return [(k, p) for k, p in out if len(p) >= MIN_PROBE]


def match_at(stream: list, start: int, probe: list) -> tuple:
    """(score, skipped): how much of `probe` appears, in order, in a window that
    BEGINS at `start`, and how many stream tokens the match stepped over.

    THE FIRST TOKEN MUST BE AT `start`. Without that the scan was free to begin
    anywhere before the heading and still find every probe token further down
    the page, so every position above the true heading scored 1.0 and the
    earliest one won. Measured against the headings title-matching had already
    found, anchors landed 150-200px high on the same page, and on a page
    boundary they landed on the previous page entirely — exercise 3 placed on
    page 2 when it is printed on page 3.

    After the first token the match stays forgiving, because OCR drops and adds
    tokens and requiring an exact run would fail on the first hyphenation.

    THE SLACK IS LOCAL, NOT A BUDGET. It used to be one window of
    len + 3*len tokens, searched greedily. A stray "a" at the foot of page 1
    then opened a 56-token window that reached the real "a tourist agency ..."
    at the top of page 2 and collected every token of it — 100%, earlier, so it
    won the tie, and the true heading was demoted to its own rival. Across the
    corpus that manufactured 334 AMBIGUOUS body probes. Each matched token must
    now sit within WINDOW_SLACK tokens of the previous match: room for OCR to
    insert a few tokens, no room to walk into a different sentence.

    SKIPS BREAK TIES. gs/2024 1/SG_Phys_2024_1_En.pdf ends page 1 with "Deduce
    whether the ball reaches the hole"; page 2 opens "The aim of this exercise".
    Starting at that last "the", "aim" is four tokens on — within slack — and
    the rest follows, so it scored 100% like the real start did, and being
    earlier it won. The real start steps over nothing.
    """
    if not probe:
        return 0.0, 0
    if start >= len(stream) or stream[start][0] != probe[0]:
        return 0.0, 0

    i, hit, skipped = start + 1, 1, 0
    for tok in probe[1:]:
        limit = min(len(stream), i + WINDOW_SLACK + 1)
        j = i
        while j < limit and stream[j][0] != tok:
            j += 1
        if j < limit:
            hit += 1
            skipped += j - i
            i = j + 1
    return hit / len(probe), skipped


def _line_tokens(stream: list, k: int) -> tuple:
    """(first index, tokens) of the line that token k sits on."""
    line = stream[k][4]
    a = k
    while a - 1 >= 0 and stream[a - 1][4] == line:
        a -= 1
    b = k
    while b + 1 < len(stream) and stream[b + 1][4] == line:
        b += 1
    return a, [t[0] for t in stream[a:b + 1]]


def take_heading_above(stream: list, best: int, cursor: int, heads: set) -> int:
    """Pull the anchor up over the exercise's own heading line, if that is what sits above it.

    An exercise placed by its statement starts at the statement's first line,
    which left "Exercise 2 (5 points)" — the line above — as the tail of
    exercise 1, or of a marking scheme. If the line above is a printed exercise
    heading (`heads`, read from the raw text), it is this exercise's. One short
    title line may sit between: "Exercise 1 (5 points)" / "Genetics and
    Cancer" / statement.

    The first version judged headings from tokens, and "III- (3 points)" became
    `iii points` — not heading words — so in Maths exercise III never took its
    own heading, and the line fell to exercise II in 180 papers.
    """
    if best - 1 < cursor:
        return best
    start, _toks = _line_tokens(stream, best - 1)
    if start < cursor:
        return best
    if stream[start][4] in heads:
        return start
    # heading, then a short title, then the statement
    if len(_toks) <= 8 and start - 1 >= cursor:
        start2, _t2 = _line_tokens(stream, start - 1)
        if start2 >= cursor and stream[start2][4] in heads:
            return start2
    return best


# Exercise headings that mark a boundary. Read from the RAW line, not tokens:
# tokens drop digits, and without the number "Exercise 3 (5 pts)" and a line
# that wrapped to begin "exercice est de déterminer…" look the same. The first
# token-based version cut 14 exercises short at lines like "point A",
# "problem, an oscilloscope…" and "au point A (1 ; 0 ; 1)".
# "Part A" / "Partie B" open a section inside an exercise, so they never count.
_ORDINAL_WORDS = (r"first|second|third|fourth|fifth|sixth|premier|deuxieme|deuxième|troisieme|"
                  r"troisième|quatrieme|quatrième|cinquieme|cinquième|sixieme|sixième")
_EXERCISE_HEADING = re.compile(
    r"^\W*(?:"
    r"(?:exercise|exercice)\s*(?:n\s*[°º]|no\.?)?\s*\d+(?:\s*[-:(.)]|\s*$)"      # Exercise 3 (…  Exercice N° 2 :
    rf"|(?:{_ORDINAL_WORDS})\s+(?:exercise|exercice)\b"                       # Second exercise
    r"|[ivx]+\s*[-–.)]\s*\(\s*[\d.,/ ]+\s*(?:points?|pts)"                            # IV- (8 points)
    r"|(?:التمرين|تمرين)\s+(?:الاول|الثاني|الثالث|الرابع|الخامس|السادس|\d)"            # التمرين الثاني
    # Older Biology and Chemistry papers number exercises as questions. Only
    # with a Roman numeral or an ordinal word: "Question 2 : calculate…" is a
    # sub-question.
    r"|question\s+[ivx]+\b\s*[-:(]"                                                   # Question III (4pts)
    rf"|(?:{_ORDINAL_WORDS})\s+question\b"                                            # Deuxième question
    r")")
OWN_HEAD_LINES = 2          # only the line directly below the anchor may be its own heading


def _pieces(text: str) -> tuple:
    """(folded line, caption/section/multicolumn bodies, table cells).

    Mathpix wraps headings in markup: a scheme's "\\caption{First exercise (7
    points)}" sits after "\\begin{table} \\captionsetup{…}", so it never starts
    the line, and a table header's cells are only visible once split.
    """
    t = fold(text)
    headings = re.findall(
        r"\\(?:caption|section\*?|subsection\*?|multicolumn\{[^}]*\}\{[^}]*\})\{([^{}]*)\}", t)
    # Header cells only — the first two rows. Mathpix emits a whole table as one
    # line, and a stray "i" or "n" in the body of a multiple-choice table
    # (gs/2019 1/math_en.pdf) once paired with its "Answers" header. Splitting
    # on row breaks also stops a header's last cell running on into the next
    # row ("m \\\\ \\hline 1 & ...").
    cells = []
    if "&" in t:
        for row in re.split(r"\\\\", t)[:2]:
            cells += row.split("&")
    return t, headings, cells


def is_exercise_heading(text: str) -> bool:
    t, headings, cells = _pieces(text)
    for piece in [t] + headings + cells[:2]:
        p = _clean(re.sub(r"\$[^$]*\$", " 0 ", piece))   # "( $\mathbf{7 . 5}$ points)" keeps a number
        if _EXERCISE_HEADING.search(p):
            return True
    return False


# The exam's own header — session line, certificate line, ministry. Printed once
# at the top of the paper; printed again, it opens a scheme's cover or another
# copy of the paper (gs/2019 1/math_en.pdf, page 4: "دورة العام 2019 العادية").
# Measured before use: of 349 papers that print one, 344 print it on at most
# two pages and 165 only after page 1 — a cover, never a running header.
_PAPER_HEADER = re.compile(
    r"(دوره\s+(?:العام|عام|سنه)|الدوره\s+(?:العاديه|الاستثنائيه|الاكماليه)|"
    r"امتحانات\s+الشهاده\s+الثانويه|وزاره\s+التربيه|"
    r"(?:premiere|première|deuxieme|deuxième)\s+session|session\s+(?:ordinaire|extraordinaire)|"
    r"(?:ordinary|extraordinary)\s+session)")


def is_paper_header(text: str) -> bool:
    """A short line, caption or table cell carrying the exam's header.

    Short, because "During the first session of training …" is a sentence. A
    cell counts too: ls/2007 1/math_fr.pdf heads each scheme table with
    "Q1 | MATH SV | PREMIERE SESSION-2007 | Notes".
    """
    t, headings, cells = _pieces(text)
    for piece in [t] + headings + cells:
        p = _clean(piece)
        if len(p.split()) <= 12 and _PAPER_HEADER.search(p):
            return True
    return False


def line_set(lines_json: dict, test) -> set:
    """Line indices (as numbered in token_stream) whose raw text passes `test`."""
    out, line_index = set(), 0
    for page in lines_json.get("pages", []):
        for ln in page.get("lines", []):
            if test(str(ln.get("text") or "")):
                out.add(line_index)
            line_index += 1
    return out


def heading_lines(lines_json: dict) -> set:
    """Line indices (as numbered in token_stream) that print an exercise heading."""
    out, line_index = set(), 0
    for page in lines_json.get("pages", []):
        for ln in page.get("lines", []):
            if is_exercise_heading(str(ln.get("text") or "")):
                out.add(line_index)
            line_index += 1
    return out


EXACT_SCORE = 0.80
STRONG_SCORE = 0.60
FLOOR_SCORE = 0.45
RIVAL_MARGIN = 0.10     # a second candidate this close makes it ambiguous


def align(exercises: list, stream: list, heads: set | None = None) -> list:
    """Position each exercise, in order, never going backwards.

    MONOTONIC BY CONSTRUCTION. The extractor already knows exercise 2 follows
    exercise 1; searching for each independently threw that away and let an
    exercise match a phrase reprinted in the marking scheme forty lines later.
    Each search starts after the previous exercise's anchor, so an ordering the
    canonical extraction asserts cannot be contradicted here.
    """
    results = []
    cursor = 0

    for index, ex in enumerate(exercises):
        probes = probes_for(ex)
        if not probes:
            results.append({"anchor": None, "score": 0.0, "status": "UNRESOLVED",
                            "probe": None,
                            "evidence": "exercise head has too few tokens to align on"})
            continue

        # Each probe is scored everywhere after the cursor; the best probe wins,
        # and on a tie the heading probe is kept, because it anchors on the
        # heading line rather than the first line of the body.
        choice = None
        for kind, probe in probes:
            matches = [(s, *match_at(stream, s, probe)) for s in range(cursor, len(stream))]
            if not matches:
                continue
            # Highest score; on a tie, fewest skipped tokens; then earliest.
            best, best_score, _skipped = max(matches, key=lambda m: (m[1], -m[2], -m[0]))
            scores = [(s, sc) for s, sc, _ in matches]
            # A RIVAL IS ANOTHER OCCURRENCE, not a neighbouring window.
            #
            # First this took the plain runner-up, which was always the window
            # one token over, so the margin was always zero and EXACT never
            # fired. Then it required 30 tokens of distance, which in a short
            # paper excluded a genuine repeat of the whole phrase fourteen tokens
            # later and rated it EXACT. The definition that matches the question
            # being asked — does the paper print this head twice? — is a window
            # that does not overlap the winner.
            rival = max((sc for s, sc in scores if abs(s - best) >= len(probe)), default=0.0)
            if choice is None or best_score > choice[2]:
                choice = (kind, probe, best_score, best, rival)

        if choice is None:
            results.append({"anchor": None, "score": 0.0, "status": "UNRESOLVED",
                            "probe": None,
                            "evidence": "no tokens left to search after the previous exercise"})
            continue

        kind, probe, best_score, best, rival = choice
        if best_score < FLOOR_SCORE:
            results.append({"anchor": None, "score": round(best_score, 3),
                            "status": "UNRESOLVED", "probe": kind,
                            "evidence": f"no run of head tokens scored at least {FLOOR_SCORE}"})
            continue

        # Snap to the start of the line the anchor sits on, never before the
        # cursor. The heading line "Exercise 2 (5 points) Mechanical energy"
        # anchors on "mechanical" — without this the "Exercise 2 (5 points)"
        # prefix of exercise 2's OWN heading was counted as the tail of
        # exercise 1, and the line belonged to both.
        line = stream[best][4]
        while best - 1 >= cursor and stream[best - 1][4] == line:
            best -= 1
        best = take_heading_above(stream, best, cursor, heads or set())

        separated = (best_score - rival) >= RIVAL_MARGIN
        if best_score >= EXACT_SCORE and separated and kind != "body-fallback":
            status = "EXACT"
        elif best_score >= STRONG_SCORE and separated:
            status = "STRONG"
        else:
            status = "AMBIGUOUS"

        why = (f"{kind} probe: {best_score:.0%} of {len(probe)} tokens in order; "
               f"best other occurrence {rival:.0%}; searched after exercise {index}")
        if kind == "body-fallback":
            why += "; title not found in print, placed by body — capped below EXACT"
        if not separated:
            why += "; another occurrence scores within the margin"

        results.append({"anchor": best, "score": round(best_score, 3), "status": status,
                        "probe": kind, "evidence": why})
        cursor = best + 1

    return results


def spans_for(stream: list, start_tok: int, end_tok: int, bounds: dict) -> list:
    """Page-local segments between two token positions.

    One segment per page the exercise touches. An exercise crossing a page
    break gets `page 4: y=620 → bottom` and `page 5: top → y=410`, because a
    single rectangle spanning both would claim territory on each page that the
    exercise never occupied — and a figure in that territory would be captured
    by it.
    """
    segs = {}
    for k in range(start_tok, min(end_tok, len(stream))):
        _tok, page, y0, y1, line_idx = stream[k]
        if page is None or y0 is None:
            continue
        seg = segs.setdefault(page, {"page": page, "yStart": y0, "yEnd": y1 or y0,
                                     "lineFrom": line_idx, "lineTo": line_idx})
        seg["yStart"] = min(seg["yStart"], y0)
        seg["yEnd"] = max(seg["yEnd"], y1 or y0)
        seg["lineFrom"] = min(seg["lineFrom"], line_idx)
        seg["lineTo"] = max(seg["lineTo"], line_idx)

    out = []
    for page in sorted(segs):
        seg = segs[page]
        height, _w = bounds.get(page, (None, None))
        seg["pageHeight"] = height
        out.append(seg)
    return out


# --------------------------------------------------------------------------
# Marking-scheme territory
#
# The canonical extractor sometimes folds the marking scheme into the last
# exercise before it: in ls/2018 1/bio_en.pdf exercise 4's final part runs on
# into "Exercise 1 : Diagnosis of Galactosemia  Correction  Marks ...". Its span
# then claimed pages 5 and 6, where the scheme for exercise 1 is printed, and a
# figure there would have been handed to exercise 4. 261 containers crossed a
# scheme heading this way.
#
# This layer may not re-segment, so the container is not cut. Its span is split
# instead: `spans` ends at the first scheme line inside its range, and what
# follows is kept, unowned, in `trailingSpans`.
# --------------------------------------------------------------------------
# A scheme heading, a scheme caption, or the header cell of a scheme table.
# Word boundaries matter: "corriger celles qui sont incorrectes" is an
# instruction to the student, and it starts with "corrige".
_SCHEME_WORDS = (r"marking scheme|bareme|barème|corrige|corrigé|answer key|"
                 r"مشروع اسس التصحيح|اسس التصحيح|اسس تصحيح|معايير التصحيح")
# A heading that is only this word: "\\section*{Réponses}". Never as part of a
# sentence — "Justifier vos réponses." is an instruction.
_SCHEME_WHOLE = {"réponses", "reponses", "corrigé", "corrige",
                 "éléments de réponse", "elements de reponse", "éléments de réponses",
                 "elements de reponses", "elements of answers"}
_SCHEME_START = re.compile(rf"^\W*({_SCHEME_WORDS})(?!\w)")
# "Answer the following questions" opens statements everywhere, so these count
# only as a whole table cell — the header of a scheme table. And an "Answers"
# header also tops multiple-choice tables inside statements (gs/2005 2/
# math_en.pdf, page 1: "No | Questions | Answers a b c d"), so an answer cell
# needs a marks column beside it. "Corrigé" never heads a statement column.
_CORRECTION_CELL = {"correction", "corrigé", "corrige", "expected answer", "expected answers",
                    "réponse attendue", "réponses attendues", "reponse attendue", "reponses attendues"}
_ANSWER_CELL = re.compile(r"^\W*(?:short\s+)?(answers?|r[eé]ponses?|solutions?|[eé]l[eé]ments? de r[eé]ponses?|"
                          r"elements? of answers?|الاجابه|الاجوبه)\W*$")
# "Q.IV", "QII", "Q 2", or a bare Roman numeral; never "Questions", which heads
# the multiple-choice tables above.
_QUESTION_CELL = re.compile(r"^\W*(q|q\W*[ivx0-9]+[a-z]?|[ivx]+|part|partie|part of the (?:q|ex|exercise)|"
                            r"partie de la q)\W*$")
# "Mark", "Notes", "Grade 5 pts" — a marks word, optionally with the total.
_MARK_CELL = re.compile(r"^\W*(marks?|notes?|grades?|pts|points|barème|bareme|علامه|العلامه|علامات)"
                        r"[\s\d.,/]*(?:pts|points)?\W*$")
# Inside a short heading ("math-bareme-session 1-2013", "barème de chimie")
# the word may sit anywhere; these never occur in a statement's own heading.
_SCHEME_ANYWHERE = re.compile(r"(?<!\w)(marking scheme|bareme|barème|answer key|اسس التصحيح|اسس تصحيح)(?!\w)")


def _clean(piece: str) -> str:
    # "\begin{tabular}[t]{|l|l|l|}" — the column spec would otherwise survive
    # as "t l l l" in front of the first cell.
    p = re.sub(r"\\begin\{[^}]*\}(\[[^\]]*\])?(\{[^}]*\})?", " ", piece)
    p = re.sub(r"\\[a-zA-Z]+\*?", " ", p)            # \hline, \caption …
    return re.sub(r"\s+", " ", re.sub(r"[{}\[\]|$\\]", " ", p)).strip()


def is_scheme_marker(text: str) -> bool:
    t, headings, cells = _pieces(text)
    for piece in [t] + headings + cells:
        p = _clean(piece)
        if _SCHEME_START.search(p):
            return True
        if len(p.split()) <= 8 and _SCHEME_ANYWHERE.search(p):
            return True
    titles = re.findall(r"\\(?:caption|section\*?|subsection\*?)\{([^{}]*)\}", t)
    if any(_clean(x) in _SCHEME_WHOLE for x in [t] + titles):
        return True
    parts = {_clean(c) for c in cells + headings}
    if parts & _CORRECTION_CELL:
        return True
    # Two of the three scheme columns — question, answer, marks. Never one
    # alone: "No | Questions | Answers a b c d" is a statement's table.
    # Single letters are weak: a data table headed "i | n" (current, count) is
    # not a scheme, so "m", "n" and a bare Roman numeral count only beside a
    # strong column.
    answer = 2 if any(_ANSWER_CELL.match(c) for c in parts) else 0
    q_cells = [c for c in parts if _QUESTION_CELL.match(c)]
    question = 2 if any(not re.fullmatch(r"[ivx]+\W*", c) for c in q_cells) else (1 if q_cells else 0)
    mark = 2 if any(_MARK_CELL.match(c) for c in parts) else (1 if parts & {"m", "n"} else 0)
    kinds = [k for k in (answer, question, mark) if k]
    return len(kinds) >= 2 and max(kinds) == 2


def scheme_lines(lines_json: dict) -> set:
    """Line indices (as numbered in token_stream) that open scheme territory."""
    out, line_index = set(), 0
    for page in lines_json.get("pages", []):
        for ln in page.get("lines", []):
            if is_scheme_marker(str(ln.get("text") or "")):
                out.add(line_index)
            line_index += 1
    return out


PAGE_TOP_LINES = 2          # short lines a cut may carry with it at the top of a page
PAGE_TOP_TOKENS = 8


def page_top_cut(stream: list, cut: int, anchor: int) -> int:
    """Move a cut up to the top of its page when only short lines precede it there.

    SV_Phys_2022_1_En.pdf opens page 4 with "مسابقة في مادة الفيزياء" and then
    "أسس التصحيح - إنكليزي"; SELH_Phys_2021_1_En_0.pdf opens page 3 with
    "Motion of a sled" and then a scheme table captioned "Exercise 1 (7 pts)".
    The cut fell on the second line and left the first — the scheme's cover —
    as a one-line continuation of the last exercise. Only at the top of a page:
    on the page where the exercise itself ends, a short last line ("Deduce c.")
    above a scheme heading is the exercise's.
    """
    page = stream[cut][1]
    first = cut
    while first - 1 > anchor and stream[first - 1][1] == page:
        first -= 1
    if first == cut or stream[first - 1][1] == page:
        return cut                  # nothing above on this page, or the anchor is on it
    lines = {}
    for k in range(first, cut):
        lines.setdefault(stream[k][4], 0)
        lines[stream[k][4]] += 1
    if len(lines) <= PAGE_TOP_LINES and all(n <= PAGE_TOP_TOKENS for n in lines.values()):
        return first
    return cut


def position_paper(row: dict) -> dict | None:
    sha = row.get("sha256")
    exercises = row.get("exercises") or []
    lines_path = META / str(sha) / "lines.json"
    if not sha or not exercises or not lines_path.exists():
        return None
    try:
        data = json.loads(lines_path.read_text(encoding="utf-8"))
    except Exception:
        return None

    containers = build_containers(exercises, data)
    if containers is None:
        return None
    return {
        "sha256": sha,
        "paper": str(row.get("path", "")).replace("\\", "/"),
        "track": row.get("track"),
        "session": row.get("session"),
        "language": row.get("language"),
        "pages": row.get("pages"),
        "containers": containers,
    }


def build_containers(exercises: list, data: dict) -> list | None:
    """Align, then turn anchors into page-local spans. The fixtures call this too."""
    stream = token_stream(data)
    if not stream:
        return None
    bounds = page_bounds(data)
    heads = heading_lines(data)
    aligned = align(exercises, stream, heads)

    # WHERE STATEMENT TERRITORY ENDS. The earliest of:
    #   next-container     the next container's anchor;
    #   scheme-marker      a marking-scheme heading or table header;
    #   paper-header       the exam's own header printed again;
    #   unclaimed-heading  a printed exercise heading no container claims.
    # The third is what catches a scheme with no scheme word in it:
    # gs/2006 2/phy_en.pdf ends its fourth exercise and prints "First exercise :
    # (6 1/2 pts)" with the answers. The paper restarting its own heading
    # sequence is positional evidence; it needs no reading of the answers.
    # Whatever lies past the end is kept in `trailingSpans`, not dropped and
    # not owned.
    anchors = [a["anchor"] for a in aligned]
    schemes = scheme_lines(data)
    headers = line_set(data, is_paper_header)
    containers = []
    heading_cuts = {}       # container position -> (cut token, next anchor token)
    for i, (ex, al) in enumerate(zip(exercises, aligned)):
        nxt = next((a for a in anchors[i + 1:] if a is not None), len(stream))
        segs, trailing, reason = [], [], None
        if al["anchor"] is not None:
            reason = "next-container" if nxt < len(stream) else "paper-end"
            own = stream[al["anchor"]][4]
            cut = None
            for k in range(al["anchor"] + 1, min(nxt, len(stream))):
                line = stream[k][4]
                if line == own:
                    continue
                if line in schemes:
                    cut, reason = k, "scheme-marker"
                    break
                if line in headers:
                    cut, reason = k, "paper-header"
                    break
                # The container's own first lines may hold its heading below
                # its title ("Diagnosis of Galactosemia" / "Exercise 1 (5.5
                # points)"), so the line directly below is exempt.
                if line in heads and line - own >= OWN_HEAD_LINES:
                    cut, reason = k, "unclaimed-heading"
                    break
            if cut is not None:
                while cut - 1 > al["anchor"] and stream[cut - 1][4] == stream[cut][4]:
                    cut -= 1
                cut = page_top_cut(stream, cut, al["anchor"])
            segs = spans_for(stream, al["anchor"], cut if cut is not None else nxt, bounds)
            trailing = spans_for(stream, cut, nxt, bounds) if cut is not None else []
            if reason == "unclaimed-heading":
                heading_cuts[i] = (cut, nxt)
        containers.append({
            "index": ex.get("index"),
            "ordinal": i + 1,
            "title": (ex.get("title") or "")[:120],
            "marks": ex.get("marks"),
            "partCount": len(ex.get("parts") or []),
            "alignment": {
                "status": al["status"],
                "score": al["score"],
                "probe": al.get("probe"),
                "evidence": al["evidence"],
                "anchorToken": al["anchor"],
            },
            "spans": segs,
            "endReason": reason,
            "trailingSpans": trailing,
            # The extractor built this container out of a marking scheme
            # (gs/2019 1/chem_en.pdf prints its scheme first; ls/2018 1/bio_en.pdf
            # has a container titled over the scheme table for exercise 2).
            # A marker on the anchor line or within the next two lines. Reported,
            # not fixed — this layer cannot re-segment.
            "startsInScheme": al["anchor"] is not None and any(
                stream[al["anchor"]][4] + k in schemes for k in range(3)),
            "leadInSpans": [],
        })

    # LEAD-IN. lh/2016 2/bio_en.pdf prints "Exercise 2 (7 points)", a reading
    # passage, then "1- Show that …" — where the extracted statement of
    # exercise 2 begins; the extraction dropped the passage. The region from
    # that heading to the anchor is recorded as the next container's lead-in:
    # positioned, attributed, but not statement territory, because the
    # canonical text does not contain it. Only when nothing else could own it —
    # no second heading inside it, and the next container did not anchor on a
    # heading of its own (then the region is a missing container's, as in
    # gs/2008 2/phy_en.pdf, and is nobody's lead-in).
    for i, (cut, nxt) in heading_cuts.items():
        # The very next container only: with an unplaced one in between
        # (lh/2021 1/SELH_Bio_2021_1_Fr_0.pdf), the region may be that one's.
        j = i + 1
        if j >= len(aligned) or aligned[j]["anchor"] != nxt or stream[nxt][4] in heads:
            continue
        cut_line = stream[cut][4]
        if any(stream[k][4] in heads and stream[k][4] != cut_line for k in range(cut, nxt)):
            continue
        containers[j]["leadInSpans"] = spans_for(stream, cut, nxt, bounds)

    # SHARED LINES. Mathpix emits some Geography question tables as a single
    # line, and several containers then align inside it (gs/2007 1/geo.pdf:
    # three on the line at y=212). The alignment inside the line is right, but
    # a line has one position: the page cannot say where in it each container
    # begins, so none of them may claim EXACT or STRONG. They keep their spans;
    # the status says how far those spans can be trusted.
    first_line = {}
    for c in containers:
        if c["spans"]:
            first_line.setdefault(c["spans"][0]["lineFrom"], []).append(c["ordinal"])
    for c in containers:
        if not c["spans"]:
            continue
        others = [o for o in first_line[c["spans"][0]["lineFrom"]] if o != c["ordinal"]]
        if others:
            a = c["alignment"]
            if a["status"] in ("EXACT", "STRONG"):
                a["status"] = "AMBIGUOUS"
            a["evidence"] += (f"; shares its first printed line with container(s) {others} — "
                              f"no position finer than that line")
    return containers


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--show", default=None, help="print one paper's alignment and exit")
    ap.add_argument("--out", default=str(OUT_FILE))
    args = ap.parse_args()

    rows = json.loads(EXAMS_JSON.read_text(encoding="utf-8"))
    rows = [r for r in rows if r.get("sha256")]
    rows.sort(key=lambda r: str(r.get("path", "")).replace("\\", "/"))

    if args.show:
        target = args.show.replace("\\", "/")
        row = next((r for r in rows if str(r.get("path", "")).replace("\\", "/") == target), None)
        if not row:
            print(f"no such paper: {target}")
            return
        result = position_paper(row)
        print(json.dumps(result, ensure_ascii=False, indent=1))
        return

    if args.limit:
        rows = rows[: args.limit]

    out = []
    for row in rows:
        r = position_paper(row)
        if r:
            out.append(r)

    out.sort(key=lambda r: (r["paper"], r["sha256"]))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(
        json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8"
    )

    counts = {"EXACT": 0, "STRONG": 0, "AMBIGUOUS": 0, "UNRESOLVED": 0}
    per_paper = []
    for paper in out:
        good = 0
        for c in paper["containers"]:
            counts[c["alignment"]["status"]] += 1
            if c["alignment"]["status"] in ("EXACT", "STRONG"):
                good += 1
        per_paper.append((paper["paper"], len(paper["containers"]), good))

    total = sum(counts.values())
    print(f"papers positioned : {len(out)}")
    print(f"containers        : {total}")
    for k in ("EXACT", "STRONG", "AMBIGUOUS", "UNRESOLVED"):
        pct = (counts[k] / total * 100) if total else 0
        print(f"  {k:<11}{counts[k]:>6}  {pct:>5.1f}%")
    full = sum(1 for _, n, g in per_paper if n and g == n)
    part = sum(1 for _, n, g in per_paper if n and 0 < g < n)
    none = sum(1 for _, n, g in per_paper if n and g == 0)
    print(f"papers fully positioned   : {full}")
    print(f"papers partly positioned  : {part}")
    print(f"papers with none          : {none}")
    digest = hashlib.sha256(Path(args.out).read_bytes()).hexdigest()
    print(f"artifact : {args.out}")
    print(f"sha256   : {digest}")


if __name__ == "__main__":
    main()
