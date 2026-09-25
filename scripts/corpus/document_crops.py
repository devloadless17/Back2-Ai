# -*- coding: utf-8 -*-
"""Crops each printed مستند off the page, for the subjects Mathpix never read.

    python scripts/corpus/document_crops.py --report          # counts only, writes nothing
    python scripts/corpus/document_crops.py --apply
    python scripts/corpus/document_crops.py --apply --paper "gs/2021 1/SVSG_Tarbia_2021_1.pdf"

WHY THIS EXISTS. The C1/C2/C3 pipeline owns figures that Mathpix cropped, and
Mathpix was only ever run on the science papers and Geography. Civics, Economics
and Sociology have no crops at all, so no amount of ownership work can give
them a figure — there is nothing to own.

And their documents are not pictures. A civics مستند is a framed block of text;
an economics one is a data table. Both are a REGION OF THE PAGE, which is why
extracting them as text loses the thing that matters: se/2005 1/ektesad_ar.pdf
prints ٧٠٠,٠٠٠ in a table the question is answered from, and the text layer
stores it as `۰۰۰٫۰۰۷`. A picture of the region has no such failure mode.

HOW A CAPTION IS TOLD FROM A MENTION. "مستند رقم (2)" at the START of a line is
a caption; "من خلال المستند رقم (2)" in the middle of one is a question talking
about it. That anchor is the whole discriminator — an earlier version also
required the line to be short and lost every caption that carries a title
("مستند رقم ٢: التصور الحكومي لحل أزمة البطالة في مصر").

pdfplumber emits Arabic right-to-left reversed, so each token is reversed back
and the line rebuilt by descending x before any of this is matched.

WHERE THE REGION ENDS. Three rules, in order:

  a framed box or image opening just below the caption   its bottom edge
  one closing just above it                              its top edge
  neither                                                the next caption

The second rule is not symmetry for its own sake: civics and economics print the
caption above the document, and a Geography map prints it underneath.

NOT WIRED TO THE DATABASE. This writes crops and a manifest. Registering them as
visual evidence — occurrence rows, and the link to the question whose text cites
that document number — is a separate step, and wants the document numbers to be
right first (see `broken_digits.py`).
"""

import argparse
import hashlib
import json
import logging
import pathlib
import re
import sys
import unicodedata
import warnings

sys.stdout.reconfigure(encoding="utf-8")
warnings.filterwarnings("ignore")
logging.getLogger("pdfminer").setLevel(logging.ERROR)

import pdfplumber  # noqa: E402
import pypdfium2 as pdfium  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXAMS = ROOT / "corpus" / "exams"
OUT = ROOT / "corpus" / "document-crops"

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from extract_exams import profile_for  # noqa: E402

# Mathpix read the science papers and Geography; these are the ones with no
# crops at all. Geography is included because 192 of its crops are unowned and a
# captioned region is a second, independent route to the same figure.
SUBJECTS = {"civics", "economics", "sociology", "geography"}

# Accommodation papers, excluded from this corpus everywhere else.
ACCOMMODATION = ("ehteyejet", "ehtiyejet", "makfufin", "makfoufen", "mu5tasa", "mokhtasa")

SCALE = 2.5  # ~180 dpi: enough to read a table's digits without inflating storage
# The bracket may be either way round. Reversing a token does not mirror it, so
# the "(١)" a paper prints arrives as ")١(" — which cost 242 of 595 captions
# their number until the class allowed both.
CAPTION = re.compile(r"^\s*(?:ال)?مستند\s*رقم\s*[()]?\s*([0-9٠-٩۰-۹])?")
NUMBERED = re.compile(r"^\s*[\d٠-٩]+\s*[-.]")
TO_LATIN = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")

MIN_HEIGHT = 25.0   # below this a "region" is a stray line, not a document
MAX_HEIGHT = 700.0  # above it the bottom rule has clearly run away

# A page that says it is the marking scheme, in the words these papers use.
#
# TWO GUARDS, NOT ONE, because the first is wrong. `paperPages` from
# `extract_exams.py` puts the split for gs/2021 1/SVSG_Tarbia_2021_1.pdf after
# page 3 — and page 3 is headed معيار التصحيح and prints the answer to every
# question. Cropping it produced a second "مستند رقم ١" that was really the
# marking scheme's copy, sitting beside the answers.
#
# A page-level check cannot be fooled by a mis-drawn boundary, and it fails in
# the safe direction: the cost of a false positive is one uncropped document,
# the cost of a false negative is handing a student the answer key.
SCHEME_MARKERS = ("معيار التصحيح", "أسس التصحيح", "أسس تصحيح", "سلم التصحيح",
                  "مشروع التصحيح", "أسئلة وأجوبة", "الإجابة النموذجية")


def true(text: str) -> str:
    """One pdfplumber token, back in reading order."""
    return unicodedata.normalize("NFKC", text)[::-1]


def lines_of(page) -> list:
    rows = {}
    for word in page.extract_words():
        rows.setdefault(round(float(word["top"]) / 3), []).append(word)
    out = []
    for _, words in sorted(rows.items()):
        words.sort(key=lambda w: -float(w["x0"]))
        out.append({
            "text": " ".join(true(w["text"]) for w in words),
            "top": min(float(w["top"]) for w in words),
            "bottom": max(float(w["bottom"]) for w in words),
        })
    return out


def objects(page) -> list:
    """Anything a document could BE: a framed box, or a printed image."""
    boxes = [(float(t.bbox[1]), float(t.bbox[3])) for t in page.find_tables()]
    boxes += [(float(i["top"]), float(i["bottom"])) for i in page.images
              if float(i["bottom"]) - float(i["top"]) > 40]
    return sorted(boxes)


def is_scheme(lines: list) -> bool:
    """Does this page announce itself as the marking scheme?"""
    head = " ".join(l["text"] for l in lines[:12])
    return any(marker in head for marker in SCHEME_MARKERS)


def regions(page, lines=None) -> list:
    """(number, top, bottom) for each captioned document on this page."""
    lines = lines_of(page) if lines is None else lines
    caps = [(l, CAPTION.match(l["text"])) for l in lines]
    caps = [(l, m) for l, m in caps if m]
    objs = objects(page)
    height = float(page.height)
    out = []

    for i, (cap, match) in enumerate(caps):
        top, bottom = cap["top"] - 4, None
        below = next((o for o in objs if cap["bottom"] - 4 <= o[0] <= cap["bottom"] + 40), None)
        above = next((o for o in reversed(objs) if cap["top"] - 60 <= o[1] <= cap["top"] + 6), None)
        if below:
            bottom = below[1] + 4
        elif above:
            top, bottom = above[0] - 4, cap["bottom"] + 4
        elif i + 1 < len(caps):
            bottom = caps[i + 1][0]["top"] - 6
        else:
            nxt = next((l["top"] for l in lines
                        if l["top"] > cap["bottom"] + 30 and NUMBERED.match(l["text"])), None)
            bottom = (nxt - 6) if nxt else height - 40

        bottom = min(bottom, height)
        if not MIN_HEIGHT <= bottom - top <= MAX_HEIGHT:
            continue
        raw = match.group(1)
        out.append({
            "number": int(raw.translate(TO_LATIN)) if raw else None,
            "caption": cap["text"][:60],
            "top": top,
            "bottom": bottom,
        })
    return out


def paper_page_counts() -> dict:
    """How many leading pages of each PDF are the QUESTION paper.

    These PDFs carry the marking scheme after the paper, and it reprints every
    مستند alongside the answers. Cropping it produced a second copy of each
    document — visible in the manifest as numbers running 1,2,1,2 — and any one
    of those crops would have handed a student the answer key. `extract_exams.py`
    already decides where the paper ends, so that decision is reused rather than
    guessed at again here. A paper it has no entry for is skipped: an unknown
    split is not an excuse to crop the whole file.
    """
    path = ROOT / "corpus" / "exams.json"
    if not path.exists():
        sys.exit("corpus/exams.json is missing — run `npm run corpus:extract-exams` first")
    out = {}
    for exam in json.loads(path.read_text(encoding="utf-8")):
        pages = exam.get("paperPages") or 0
        if pages:
            out[exam["path"].replace("\\", "/")] = pages
    return out


def papers(only: str | None) -> list:
    limits = paper_page_counts()
    found, unknown = [], 0
    for pdf in sorted(EXAMS.glob("*/*/*.pdf")):
        if profile_for(str(pdf)) not in SUBJECTS:
            continue
        if any(bad in pdf.name.lower() for bad in ACCOMMODATION):
            continue
        rel = pdf.relative_to(EXAMS).as_posix()
        if only and only not in rel:
            continue
        if rel not in limits:
            unknown += 1
            continue
        found.append((rel, pdf, limits[rel]))
    if unknown:
        print(f"  {unknown} paper(s) skipped: no paper/scheme split on record")
    return found


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write the crops and the manifest")
    ap.add_argument("--report", action="store_true", help="counts only")
    ap.add_argument("--paper", default=None, help="restrict to paths containing this")
    args = ap.parse_args()
    if not args.apply and not args.report:
        ap.error("one of --apply or --report is required")

    if args.apply:
        OUT.mkdir(parents=True, exist_ok=True)

    manifest, by_subject = [], {}
    todo = papers(args.paper)
    for n, (rel, pdf, paper_pages) in enumerate(todo, 1):
        subject = profile_for(str(pdf))
        try:
            with pdfplumber.open(pdf) as doc:
                found = []
                for i, page in enumerate(doc.pages[:paper_pages], 1):
                    lines = lines_of(page)
                    # A scheme never turns back into the paper, and only its
                    # FIRST page carries the title — gs/2019/tarbeya.pdf heads
                    # page 3 "مشروع معيار التصحيح" and then simply continues on
                    # page 4, which a per-page test reads as an ordinary paper
                    # page and crops. So the first marker ends the paper.
                    if is_scheme(lines):
                        break
                    found.append((i, float(page.width), float(page.height),
                                  regions(page, lines)))
        except Exception as exc:
            print(f"  ERROR {rel}: {type(exc).__name__}")
            continue

        total = sum(len(r) for _, _, _, r in found)
        tally = by_subject.setdefault(subject, {"papers": 0, "with": 0, "crops": 0})
        tally["papers"] += 1
        tally["crops"] += total
        if total:
            tally["with"] += 1
        if not total or not args.apply:
            continue

        sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
        render = pdfium.PdfDocument(pdf)
        for page_no, width, height, found_here in found:
            if not found_here:
                continue
            image = render[page_no - 1].render(scale=SCALE).to_pil()
            for order, region in enumerate(found_here, 1):
                box = (0, int(region["top"] * SCALE),
                       int(width * SCALE), int(region["bottom"] * SCALE))
                crop = image.crop(box)
                name = f"{sha[:12]}-p{page_no}-d{order}.png"
                crop.save(OUT / name)
                manifest.append({
                    "paper": rel, "paperSha256": sha, "file": name,
                    "page": page_no, "documentNumber": region["number"],
                    "caption": region["caption"], "readingOrder": order,
                    "bbox": [0, round(region["top"], 1), round(width, 1), round(region["bottom"], 1)],
                    "pageWidth": round(width, 1), "pageHeight": round(height, 1),
                })
        if n % 25 == 0:
            print(f"  … {n}/{len(todo)} papers")

    print(f"\n{'subject':<12}{'papers':>8}{'with documents':>16}{'crops':>8}")
    for subject, tally in sorted(by_subject.items(), key=lambda kv: -kv[1]["crops"]):
        print(f"{subject:<12}{tally['papers']:>8}{tally['with']:>16}{tally['crops']:>8}")

    if args.apply and args.paper:
        # A filtered run writes its crops but NOT the manifest: the manifest
        # describes the whole corpus, and a one-paper run that overwrote it left
        # 354 orphaned PNGs on disk described by a six-line file.
        print(f"\n{len(manifest)} crop(s) -> {OUT}")
        print("  manifest NOT rewritten (--paper); re-run without it to refresh")
        report_repeats(manifest)
    elif args.apply:
        path = OUT / "manifest.json"
        path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
        unnumbered = sum(1 for m in manifest if m["documentNumber"] is None)
        print(f"\n{len(manifest)} crop(s) -> {OUT}")
        print(f"  {unnumbered} caption(s) had no readable number — not guessed")
        print(f"  manifest: {path.relative_to(ROOT)}")
        report_repeats(manifest)


def report_repeats(manifest: list) -> None:
    """Papers where a document number appears twice — say so, loudly.

    A paper numbers its documents once. Seeing 1,2,3,1,2,3 means the same
    document was cropped twice, and the overwhelmingly likely reason is that
    the second copy came off the marking scheme, which prints every مستند
    beside its answer. Both guards above missed those pages — the older papers
    head their scheme differently, or not at all.

    These crops are NOT safe to publish. They are left on disk deliberately:
    deleting them would hide how many there are, and the number is the point.
    """
    by_paper = {}
    for crop in manifest:
        by_paper.setdefault(crop["paper"], []).append(crop)

    suspect = []
    for paper, crops in sorted(by_paper.items()):
        crops.sort(key=lambda c: (c["page"], c["readingOrder"]))
        numbers = [c["documentNumber"] for c in crops if c["documentNumber"] is not None]
        if len(numbers) != len(set(numbers)):
            suspect.append((paper, [c["documentNumber"] for c in crops]))

    if not suspect:
        return
    print(f"\n  ⚠ {len(suspect)} paper(s) repeat a document number — almost certainly the")
    print("    marking scheme's copy. DO NOT serve these until each is checked by eye:")
    for paper, numbers in suspect[:10]:
        print(f"      {paper:<34}{numbers}")
    if len(suspect) > 10:
        print(f"      … and {len(suspect) - 10} more (every one is in the manifest)")


if __name__ == "__main__":
    main()
