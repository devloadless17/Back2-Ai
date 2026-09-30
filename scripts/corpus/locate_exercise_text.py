"""
Finds a question's own words on the printed page, using the PDF's text layer.

    python scripts/corpus/locate_exercise_text.py --work <work.json> --out <placements.json>

WHY THIS EXISTS ALONGSIDE C1. `place-flattened-rows.ts` finds the exercise in
`exams.json` and takes its printed position from C1. That works for the papers
C1 read, and stops dead for the rest: of the science rows still showing
flattened formulas, 66 match an exercise C1 never positioned — 57 of them on a
paper with only one printing, so there is no sibling edition to borrow a
position from — and 67 more do not appear in `exams.json` at all.

Both are the same problem seen twice: the intermediate artefacts do not cover
these papers. The PDF does. Every one of these questions was printed, and the
printing carries its own text layer with a box for every character, so the
question can be found on the page directly and the band cut from where it sits.

IT MATCHES ON LETTERS WITH THE SPACES REMOVED. The production text layer breaks
words apart — "organi sm", "In orde r" — which destroys word tokens and is why
those 67 rows matched nothing. Stripping to letters alone makes the comparison
immune to it: a space inserted inside a word changes no letter.

A PROBE IS NOT A SCORE. A 60-character run of the question's own letters, found
in order on the page, cannot happen by chance; two of them even less so. So this
asks for at least two, and for no OTHER paper to answer as well, rather than
ranking papers by similarity.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys

import pypdfium2 as pdfium

ROOTS = ("corpus/exams", "corpus", "corpus/papers")

LETTERS = re.compile(r"[^\W\d_]", re.UNICODE)
# "lh/2018 1" -> ("2018", "1"); the track in front of it is deliberately ignored.
SITTING = re.compile(r"(\d{4})(?:\s+(\d))?")

# Long enough that a run of it cannot coincide, short enough to survive a word
# the reader mangled in the middle of the question.
PROBE = 60
# Taken across the body so that one damaged passage cannot hide the whole row.
#
# THE FIRST AND LAST MATTER MORE THAN THE REST. The band runs from the earliest
# probe found to the latest, so probing from 6% in cut the opening line off the
# picture — the question began above the band. Probing from the very start and
# very end makes the band the whole question whenever those survive, and the
# middle offsets keep it working when they do not.
OFFSETS = (0.0, 0.06, 0.24, 0.42, 0.60, 0.78, 0.94, 0.995)
# Fewer than this and the match is not safe to show a student.
MIN_HITS = 2


def letters_only(text: str) -> str:
    return "".join(LETTERS.findall(text.lower()))


def probes_of(normalised: str) -> list[tuple[int, str]]:
    """Each probe with the character offset in the body it was taken from.

    The offset travels with the probe because the check below compares how fast
    the page advances against how far apart the probes are in the question; the
    probes are not evenly spaced, so a raw step tells you nothing.
    """
    out: list[tuple[int, str]] = []
    seen: set[str] = set()
    for fraction in OFFSETS:
        start = int(len(normalised) * fraction)
        start = min(start, max(0, len(normalised) - PROBE))
        probe = normalised[start : start + PROBE]
        if len(probe) == PROBE and probe not in seen:
            seen.add(probe)
            out.append((start, probe))
    return out


# The paper's identity is the sha256 of its bytes, which is what `exams.json`
# and every visual occurrence already key on, so a band located this way lands
# beside the ones C1 placed rather than in a parallel world of its own.
_SHA: dict[str, str] = {}


def paper_sha256(path: str) -> str:
    cached = _SHA.get(path)
    if cached is None:
        cached = hashlib.sha256(open(path, "rb").read()).hexdigest()
        _SHA[path] = cached
    return cached


def find_pdf(rel: str) -> str | None:
    rel = rel.replace(chr(92), "/")
    for root in ROOTS:
        candidate = os.path.join(root, rel)
        if os.path.exists(candidate):
            return candidate
    return None


def page_index(page) -> tuple[str, list[tuple[float, float]]]:
    """The page's letters, and the top and bottom of each one."""
    textpage = page.get_textpage()
    count = textpage.count_chars()
    height = page.get_size()[1]
    letters, boxes = [], []
    for i in range(count):
        ch = textpage.get_text_range(i, 1)
        if not ch or not LETTERS.match(ch):
            continue
        try:
            left, bottom, right, top = textpage.get_charbox(i)
        except Exception:
            continue
        # PDF y grows upward; the rest of this pipeline measures from the top.
        letters.append(ch.lower())
        boxes.append((height - top, height - bottom))
    return "".join(letters), boxes


def consistent(hits):
    """The largest run of probes that advance through the page in step.

    `hits` is (probe index in the body, character offset on the page). The probes
    were taken in body order, so a genuine set advances monotonically and at a
    roughly even rate. This keeps the longest subsequence that does, which drops
    a probe matched by repeated boilerplate further down the page.
    """
    if len(hits) < 2:
        return hits

    # IT MUST BEGIN AT THE QUESTION'S OWN BEGINNING. `hits` is in body order, so
    # the first is the earliest surviving probe of this question — where the band
    # has to start. Taking instead whichever run happened to be longest moved a
    # band onto the third exercise of the page, because the boilerplate the
    # question ends with opens two later ones and matched more consistently
    # there. Anchoring removes that whole class of mistake.
    run = [hits[0]]
    for nxt in hits[1:]:
        if nxt[1] <= run[-1][1]:
            continue                          # the printing never goes backwards
        if len(run) >= 2:
            # How fast the page advanced per character of the question so far,
            # against the rate this step would need. The probes sit at uneven
            # places in the body, so only the RATE is comparable — measuring the
            # raw gap rejected honest steps and cut bands off a few lines in.
            rates = [
                (run[i + 1][1] - run[i][1]) / max(1, run[i + 1][0] - run[i][0])
                for i in range(len(run) - 1)
            ]
            typical = sorted(rates)[len(rates) // 2]
            rate = (nxt[1] - run[-1][1]) / max(1, nxt[0] - run[-1][0])
            if typical and rate > typical * 4:
                continue                      # this far ahead is another exercise
        run.append(nxt)
    return run


# One index per PDF, not one per question. Reading the character boxes is the
# expensive part, and a broad search asks the same paper about many questions.
_INDEX: dict[str, list[tuple[str, list[tuple[float, float]], float]]] = {}


def document_index(path: str, doc):
    cached = _INDEX.get(path)
    if cached is None:
        cached = []
        for page_no in range(len(doc)):
            page = doc[page_no]
            text, boxes = page_index(page)
            cached.append((text, boxes, page.get_size()[1]))
        _INDEX[path] = cached
    return cached


def locate(path: str, doc, normalised: str) -> dict | None:
    """Where this question sits in this document, or None if it is not here.

    A QUESTION IS OFTEN LONGER THAN A PAGE. One physics question ran from the
    start of page 1 to two thirds down page 2; returning only the page it began
    on cut half of it away, and returning only the page with the most matches
    showed a different exercise entirely. So every page carrying part of the
    question gets a span, in reading order, and the renderer stacks them.
    """
    probes = probes_of(normalised)
    if len(probes) < MIN_HITS:
        return None

    pages: list[dict] = []
    total_hits = 0
    for page_no, (text, boxes, page_height) in enumerate(document_index(path, doc)):
        if not text:
            continue
        found = [(body_at, text.find(probe)) for body_at, probe in probes]
        hits = [(body_at, at) for body_at, at in found if at >= 0]
        if not hits:
            continue
        # A PROBE BEING FOUND IS NOT ENOUGH; IT MUST SIT ON THE SAME LINE AS THE
        # REST. Exam papers repeat boilerplate — "read carefully the following
        # text then answer the questions that follow" opens several exercises on
        # one page — so the closing probe of one question can match inside the
        # NEXT one, and the band then runs on past its own exercise and into a
        # different question's text.
        #
        # The question is printed in order and at a steady rate, so its probes
        # should fall on a straight line: a probe a fifth of the way through the
        # body sits about a fifth of the way down the printed exercise. Fitting
        # that line and dropping whatever disagrees with it removes the stray
        # match, and keeps the true last probe when it is where it should be.
        kept = consistent(hits)
        if not kept:
            continue
        starts = [at for _, at in kept]
        ends = [at + PROBE for _, at in kept]
        # A QUESTION CANNOT BE LONGER IN PRINT THAN IT IS IN TEXT. The probes give
        # the rate the page advances per character of the question, so the end
        # cannot lie further than the remaining characters allow. Without this the
        # band ran past its own exercise into the next one, because the closing
        # boilerplate — the same sentence opening two later exercises — matched
        # down there and dragged the bottom edge with it.
        if len(kept) >= 2:
            rates = [
                (kept[i + 1][1] - kept[i][1]) / max(1, kept[i + 1][0] - kept[i][0])
                for i in range(len(kept) - 1)
            ]
            rate = sorted(rates)[len(rates) // 2]
            if rate > 0:
                furthest = kept[0][1] + int((len(normalised) - kept[0][0]) * rate) + PROBE
                ends = [e for e in ends if e <= furthest] or [min(ends)]
        yStart = boxes[min(starts)][0]
        yEnd = boxes[min(max(ends) - 1, len(boxes) - 1)][1]
        if yEnd <= yStart:
            continue                          # matched out of order on this page
        pages.append(
            {
                "page": page_no + 1,
                "yStart": yStart,
                "yEnd": yEnd,
                "pageHeight": page_height,
                "firstBodyAt": kept[0][0],
                "lastBodyAt": kept[-1][0],
                "hits": len(kept),
            }
        )
        total_hits += len(kept)

    if not pages:
        return None

    # THE QUESTION RUNS FORWARD THROUGH THE PAPER. Pages are kept only while each
    # carries a later part of the question than the one before, starting from the
    # page holding its opening. A page matching only repeated boilerplate sits out
    # of that order and is dropped, which is what stopped a band showing the third
    # exercise on the sheet instead of the first.
    pages.sort(key=lambda p: p["firstBodyAt"])
    run = [pages[0]]
    for nxt in pages[1:]:
        if nxt["page"] > run[-1]["page"] and nxt["firstBodyAt"] >= run[-1]["lastBodyAt"]:
            run.append(nxt)
    run.sort(key=lambda p: p["page"])
    if total_hits < MIN_HITS:
        return None
    return {"spans": [{k: p[k] for k in ("page", "yStart", "yEnd", "pageHeight")} for p in run],
            "hits": sum(p["hits"] for p in run)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, help="rows to locate: id, body, and candidate papers")
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    work = json.load(open(args.work, encoding="utf-8"))
    if args.limit:
        work = work[: args.limit]

    opened: dict[str, pdfium.PdfDocument] = {}
    placed, missed, ambiguous = [], [], []
    for row in work:
        normalised = letters_only(row.get("body") or "")
        answers = []
        for rel in row.get("papers", []):
            path = find_pdf(rel)
            if not path:
                continue
            try:
                doc = opened.get(path) or opened.setdefault(path, pdfium.PdfDocument(path))
                span = locate(path, doc, normalised)
            except Exception:
                continue
            if span and span["hits"] >= MIN_HITS:
                answers.append((rel, span))

        if not answers:
            missed.append(row["id"])
            continue
        # ONLY ONE SITTING MAY ANSWER. Two papers from the same track and session
        # carrying this question are the same exercise reprinted — the main
        # edition and its accommodation editions — and either band shows the
        # student the same page. Two DIFFERENT sittings answering equally well is
        # a real ambiguity, and is refused rather than settled by a coin toss.
        answers.sort(key=lambda a: -a[1]["hits"])
        # THE TRACK IS NOT PART OF THE SITTING. LH and SE sit the same science
        # paper, as do GS and LS, so `lh/2018 1` and `se/2018 1` are one exercise
        # filed twice — comparing the whole folder called them rivals and refused
        # 23 rows that were never ambiguous. Only the year and session identify a
        # sitting.
        sitting = lambda rel: SITTING.search(os.path.dirname(rel.replace(chr(92), "/")))
        best_rel, best_span = answers[0]
        best_sitting = sitting(best_rel)
        rival = next(
            (a for a in answers
             if (sitting(a[0]).groups() if sitting(a[0]) else None)
             != (best_sitting.groups() if best_sitting else None)),
            None,
        )
        if rival and rival[1]["hits"] >= best_span["hits"]:
            ambiguous.append(row["id"])
            continue
        rel, span = best_rel, best_span
        # A BAND NEEDS A NAME NO OTHER BAND ON THIS PAPER CAN TAKE. Occurrences are
        # keyed by (paper, crop name), and these bands have no exercise number to
        # use — the exercise was never found in `exams.json`. Where it sits on the
        # page is unique to it and stable across re-runs, so that is the name.
        first = span["spans"][0]
        ordinal = first["page"] * 10000 + int(first["yStart"])
        placed.append(
            {
                "id": row["id"],
                "subject": row.get("subject"),
                "path": rel,
                "sha": paper_sha256(find_pdf(rel) or rel),
                "ordinal": ordinal,
                "hits": span["hits"],
                "spans": span["spans"],
            }
        )

    json.dump(placed, open(args.out, "w", encoding="utf-8"), indent=1)
    print(f"located {len(placed)} of {len(work)}; not found {len(missed)}; "
          f"two sittings answered equally for {len(ambiguous)} -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
