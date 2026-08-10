# -*- coding: utf-8 -*-
"""Turns raw OCR output into text the rest of the pipeline can use.

    python scripts/corpus/normalise.py                 # every book
    python scripts/corpus/normalise.py --book math-ls-en__9de6de98
    python scripts/corpus/normalise.py --check         # report, write nothing

Reads   corpus/text/<book>/page-NNN.md
Writes  corpus/text/<book>/clean/page-NNN.md     display text
        corpus/text/<book>/search/page-NNN.md    search/embedding text
        corpus/text/<book>/document.clean.md
        corpus/meta/<book>/normalise.json        what changed, and what did not

Raw files are never modified: this has to be re-runnable after every change to
the rules, and the OCR cost is already sunk.

Two outputs, on purpose:

  clean/   what a student reads. Markup becomes Markdown, figure links point at
           files on disk, Arabic keeps the orthography the book printed.
  search/  what gets embedded. Arabic is folded (hamza and alef variants, taa
           marbuta, tatweel, Arabic-Indic digits) so that a query spelled one
           way still matches text spelled the other. Never shown to anyone.

Folding in place would destroy the display text and cannot be undone, which is
why they are separate files rather than one normalised copy.

Mathematics is protected before any rule runs and restored afterwards: a
substitution inside $...$ silently changes the meaning of a formula.
"""

import argparse
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
CORPUS = ROOT / "corpus"
TEXT = CORPUS / "text"
FIGURES = CORPUS / "figures"

# ---------------------------------------------------------------- protection
MATH = re.compile(r"\$\$[\s\S]*?\$\$|\$[^$\n]+\$")


def protect(text: str):
    spans = []

    def stash(m):
        spans.append(m.group(0))
        return f"\x00MATH{len(spans) - 1}\x00"

    return MATH.sub(stash, text), spans


def restore(text: str, spans: list) -> str:
    for i, span in enumerate(spans):
        text = text.replace(f"\x00MATH{i}\x00", span)
    return text


# ---------------------------------------------------------------- LaTeX -> md
SECTION = re.compile(r"\\(sub)?section\*?\{([^}]*)\}")
TITLE = re.compile(r"\\title\{([^}]*)\}")
AUTHOR = re.compile(r"\\author\{[^}]*\}")
DROP = re.compile(r"\\(?:captionsetup|caption|footnotetext|footnote|label|index|vspace|hspace)"
                  r"(?:\[[^\]]*\])?\{[^}]*\}")
ENV_OPEN = re.compile(r"\\begin\{(itemize|enumerate|center|figure|table)\}(?:\[[^\]]*\])?")
ENV_CLOSE = re.compile(r"\\end\{(itemize|enumerate|center|figure|table)\}")
ITEM = re.compile(r"\\item\s*(?:\[([^\]]*)\])?\s*")
TABULAR = re.compile(r"\\begin\{tabular\}(?:\[[^\]]*\])?\{[^}]*\}([\s\S]*?)\\end\{tabular\}")
# Two patterns, because OCR mangles the options group: the LH books come back
# as \includegraphics[alt={,max width=textwidth]{https://...}, with an
# unbalanced brace. Anything that stops at the first "{" lands inside the
# options and leaves the real URL behind as bare text — an expiring CDN link
# sitting in the corpus. So find the braced group that holds a URL, and only
# then fall back to dropping the command.
INCLUDE_URL = re.compile(r"\\includegraphics[^\n]{0,240}?\{(https?://[^}\s]+)\}")
INCLUDE_ANY = re.compile(r"\\includegraphics[^\n]*")
LEFTOVER = re.compile(r"\\(?:hline|newline|par|noindent|centering|small|large|textbf|textit|emph)\b")

IMAGE = re.compile(r"!\[\]\((https?://[^)\s]+)\)")


def tabular_to_markdown(match: re.Match) -> str:
    body = re.sub(r"\\hline", "", match.group(1))
    rows = [r.strip() for r in body.split(r"\\") if r.strip()]
    if not rows:
        return ""
    table = []
    for i, row in enumerate(rows):
        cells = [c.strip() for c in row.split("&")]
        table.append("| " + " | ".join(cells) + " |")
        if i == 0:
            table.append("|" + "|".join([" --- "] * len(cells)) + "|")
    return "\n".join(table)


def local_figure(book: str, url: str):
    """Maps a Mathpix CDN link to the copy downloaded from the zip.

    The link carries the crop box in its query string and the file encodes the
    same numbers in its name:
        .../<uuid>-005.jpg?height=2776&width=1898&top_left_y=73&top_left_x=73
        <uuid>-005_2776_1898_73_73.jpg
    """
    base = url.split("?")[0].split("/")[-1]
    if "." not in base:
        return None
    stem, ext = base.rsplit(".", 1)
    q = dict(re.findall(r"(\w+)=(\d+)", url))
    if not all(k in q for k in ("height", "width", "top_left_y", "top_left_x")):
        return None
    name = f"{stem}_{q['height']}_{q['width']}_{q['top_left_y']}_{q['top_left_x']}.{ext}"

    folder = FIGURES / book
    if not folder.exists():
        return None
    if (folder / name).exists():
        return name
    # run_batch.py prefixes figures with the page they came from
    hits = list(folder.glob(f"p*-{name}"))
    return hits[0].name if hits else None


def to_markdown(text: str, book: str, stats: dict) -> str:
    text, spans = protect(text)

    text = TITLE.sub(lambda m: f"# {m.group(1).strip()}", text)
    text = AUTHOR.sub("", text)
    text = SECTION.sub(lambda m: f"\n{'###' if m.group(1) else '##'} {m.group(2).strip()}\n", text)
    text = DROP.sub("", text)

    text = TABULAR.sub(tabular_to_markdown, text)

    text = ENV_OPEN.sub("", text)
    text = ENV_CLOSE.sub("", text)
    text = ITEM.sub(lambda m: f"- " if not m.group(1) or m.group(1).strip() in "-•*"
                    else f"{m.group(1).strip()} ", text)

    def image(m):
        name = local_figure(book, m.group(1))
        if name:
            stats["figuresLinked"] += 1
            return f"![](../../figures/{book}/{name})"
        stats["figuresMissing"] += 1
        return "[figure: not extracted]"

    text = IMAGE.sub(image, text)

    def include(m):
        name = local_figure(book, m.group(1))
        if name:
            stats["figuresLinked"] += 1
            return f"![](../../figures/{book}/{name})"
        stats["figuresMissing"] += 1
        return "[figure: not extracted]"

    text = INCLUDE_URL.sub(include, text)
    text = INCLUDE_ANY.sub("[figure]", text)
    text = LEFTOVER.sub("", text)

    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return restore(text, spans).strip()


# ---------------------------------------------------------------- Arabic fold
PRESENTATION = re.compile(r"[\uFB50-\uFDFF\uFE70-\uFEFF]")
TATWEEL = re.compile(r"\u0640")
DIACRITICS = re.compile(r"[\u064B-\u0652\u0670]")
AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
ALEF = str.maketrans("أإآٱ", "اااا")
OTHER = str.maketrans("ىة", "يه")


def has_arabic(text: str) -> bool:
    return any("\u0600" <= c <= "\u06ff" for c in text)


def fold_for_search(text: str) -> str:
    """The form used for embedding and search only — never displayed.

    Presentation forms look identical on screen but never match a query typed
    normally, which is the worst kind of defect: invisible until retrieval
    quietly returns nothing.
    """
    text = unicodedata.normalize("NFKC", text)
    text = TATWEEL.sub("", text)
    text = DIACRITICS.sub("", text)
    text = text.translate(AR_DIGITS).translate(ALEF).translate(OTHER)
    return re.sub(r"[ \t]{2,}", " ", text)


# ---------------------------------------------------------------- runner
def normalise_book(book: str, write: bool) -> dict:
    d = TEXT / book
    pages = sorted(d.glob("page-*.md"))
    if not pages:
        return {}

    stats = {
        "book": book, "pages": len(pages),
        "figuresLinked": 0, "figuresMissing": 0,
        "arabicPages": 0, "cdnLinksRemaining": 0, "latexRemaining": 0,
    }

    clean_dir, search_dir = d / "clean", d / "search"
    if write:
        clean_dir.mkdir(exist_ok=True)
        search_dir.mkdir(exist_ok=True)

    document = []
    for path in pages:
        raw = path.read_text(encoding="utf-8")
        clean = to_markdown(raw, book, stats)

        stats["cdnLinksRemaining"] += len(re.findall(r"https?://", clean))
        stats["latexRemaining"] += len(re.findall(r"\\(?:item|section|begin|end|hline)\b",
                                                  MATH.sub("", clean)))
        arabic = has_arabic(clean)
        if arabic:
            stats["arabicPages"] += 1

        if write:
            (clean_dir / path.name).write_text(clean, encoding="utf-8")
            # Only Arabic needs a folded copy; for Latin text the two are the
            # same and a second file would just be noise on disk.
            if arabic:
                (search_dir / path.name).write_text(fold_for_search(clean), encoding="utf-8")

        n = int(re.search(r"(\d+)", path.name).group(1))
        document.append(f"<!-- page {n} -->\n\n{clean}\n")

    if write:
        (d / "document.clean.md").write_text("\n\n---\n\n".join(document), encoding="utf-8")
        meta = CORPUS / "meta" / book
        meta.mkdir(parents=True, exist_ok=True)
        (meta / "normalise.json").write_text(
            json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")

    return stats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--book")
    ap.add_argument("--check", action="store_true", help="report only, write nothing")
    args = ap.parse_args()

    books = [args.book] if args.book else [d.name for d in sorted(TEXT.iterdir()) if d.is_dir()]

    print(f"{'book':<36}{'pages':>6}{'figs':>7}{'missing':>9}{'ar':>5}{'cdn':>6}{'latex':>7}")
    print("-" * 76)
    totals = {"pages": 0, "figuresLinked": 0, "figuresMissing": 0,
              "cdnLinksRemaining": 0, "latexRemaining": 0}

    for book in books:
        s = normalise_book(book, write=not args.check)
        if not s:
            continue
        for k in totals:
            totals[k] += s.get(k, 0)
        print(f"{book:<36}{s['pages']:>6}{s['figuresLinked']:>7}{s['figuresMissing']:>9}"
              f"{s['arabicPages']:>5}{s['cdnLinksRemaining']:>6}{s['latexRemaining']:>7}")

    print("-" * 76)
    print(f"{'TOTAL':<36}{totals['pages']:>6}{totals['figuresLinked']:>7}"
          f"{totals['figuresMissing']:>9}{'':>5}{totals['cdnLinksRemaining']:>6}"
          f"{totals['latexRemaining']:>7}")
    print()
    if totals["cdnLinksRemaining"]:
        print(f"  {totals['cdnLinksRemaining']} link(s) still point at a CDN that expires.")
    if totals["latexRemaining"]:
        print(f"  {totals['latexRemaining']} LaTeX command(s) left outside maths.")
    if totals["figuresMissing"]:
        print(f"  {totals['figuresMissing']} figure(s) referenced but not on disk.")
    print("Verify the maths survived:  npm run corpus:katex <book>")


if __name__ == "__main__":
    main()
