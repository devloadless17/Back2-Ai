# -*- coding: utf-8 -*-
"""Pull the exercises printed in the textbooks out as separate questions.

    python scripts/corpus/extract_book_exercises.py --book math-er__9de6de98 --chapters 2 --estimate
    python scripts/corpus/extract_book_exercises.py --book math-er__9de6de98 --chapters 2
    python scripts/corpus/extract_book_exercises.py --all-science --max-usd 15

Every CRDP science and maths book ends each chapter with exercises (EXERCISES,
SELF-EVALUATION, PROBLEMS, TESTEZ VOS CONNAISSANCES, Exercice I-IX ...). Until
now they only reached the app as passages, labelled as lesson content: the
tutor could quote them, practice could not offer them.

WHY A VISION MODEL, NOT A SPLITTER. The exercise pages are printed in two
columns and the Mathpix text interleaves them: in math-er chapter 2, exercise 6
reads "choose a team of / 14. Complete by checking True or False / soccer
players from 14 players". Cutting that on numbers would show students broken
statements. The model sees the page image AND the Mathpix text, and is told to
put the text back in reading order, copying the Mathpix LaTeX, not solving and
not inventing.

GUARDS, because a model asked to read a page will sometimes write one:

  * GROUNDED: at least 85% of an exercise's words must occur in the page's own
    Mathpix text (or its neighbour's, for an exercise that runs over a page).
    An exercise that fails is kept in the output with `held` set, not loaded.
  * FIGURES: an exercise that refers to a figure, graph or document is held;
    the figure pipeline does not cover book pages yet, and a question pointing
    at a picture nobody can see is worse than no question.
  * NO ANSWERS: the books print none, so none is produced here.

Which pages: from the first exercise heading in a chapter (pages taken in the
taxonomy's printed order, which matters for the shuffled scans) to the end of
the chapter. The model says so when a page holds no exercise.

Costs money, so: --estimate writes nothing; every reply is cached under
corpus/book-exercises/raw/<book>/page-NNN.json and never paid for twice;
--max-usd stops the run.

Output: corpus/book-exercises/<book>.json, read by load-book-exercises.ts.
Arabic editions of science books are never read here.
"""

import argparse
import csv
import hashlib
import json
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ocr_pdf  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "corpus"
OUT = CORPUS / "book-exercises"
CATALOG = Path(__file__).resolve().parent / "catalog.csv"

# USD per million tokens. ASSUMED, as in ocr_exams_batch.py — check them.
PRICES = {"gpt-4.1-mini": (0.40, 1.60), "gpt-4.1": (2.0, 8.0), "gpt-5.5": (5.0, 30.0)}

SCIENCE_SUBJECTS = {
    "Mathematics", "Mathematiques", "Physics", "Physique", "Chemistry", "Chimie",
    "Life Sciences", "Sciences de la vie",
}

# The headings that open an exercise section, across the fr and en editions.
START = re.compile(
    r"TESTEZ VOS CONNAISSANCES|APPLIQUEZ VOS CONNAISSANCES|PRATIQUEZ UNE D|TEST YOUR KNOWLEDGE"
    r"|APPLY YOUR KNOWLEDGE|^PROBLEMS\b|^PROBL[EÈ]MES\b|^EXERCI[CS]ES\b|^EXERCISES\b"
    r"|AUTO.{0,3}[ÉE]VALUATION|SELF.{0,3}EVALU|^Questions$|Review Questions"
    r"|QUESTIONS D.?[ÉE]VALUATION|EVALUATION EXERCISES?"
    r"|^Exercices?$|^Exercises?$|^Application des connaissances|^Ma[iî]trise|^Mastery",
    re.I,
)
# Biology's "Problems to be solved" are the questions ON the lesson's documents
# ("What can you deduce from doc.a?"): an activity, not an exercise, and
# meaningless without the document. Items the model files under them are dropped.
SKIP = re.compile(
    r"Problems? to be solved|Probl[eè]mes? [àa] r[ée]soudre|^Activit|Probing the doc|Exploitation (des|du|of the) doc",
    re.I,
)
# Chapters whose exercise heading the page reader lost (French chemistry).
NUMBERED = re.compile(r"^\W{0,3}(?:[IVX]{1,4}\s+)?\d{1,2}\s*[.)-]?\s+\S")
# "Exercise IV", "Exercice 3", "Ex. 2" -> "IV", "3", "2".
NUMBER_WORD = re.compile(r"^(?:exercises?|exercices?|problems?|probl[eè]mes?|ex)\.?\s*", re.I)
# A book's answer section, which the taxonomy files as if it were a chapter.
ANSWERS = re.compile(r"answers|hints|corrig|solutions|r[ée]ponses", re.I)
# A statement that opens on a sub-part has lost its stem to another page.
FRAGMENT = re.compile(r"^\s*(?:[a-h]\s*[)\-.]|\d\s*[)])\s")
HEADING = re.compile(r"^\s*(?:#+\s*)?(?:\\section\*\{)?\s*■?\s*(.{3,60}?)\}?\s*$")

FIGURE = re.compile(
    r"\b(fig(ure)?s?\.?\s*\d|figure|graph(e|ique)?\b|diagram|sch[ée]ma|document\s*\d|doc\.?\s*\d"
    r"|the curve (below|opposite|shown)|la courbe (ci-contre|ci-dessous)|ci-contre|opposite"
    r"|docs?|documents?)\b",
    re.I,
)

SYSTEM = """You read one page of a Lebanese secondary-school textbook and return the exercises printed on it, one by one.

You are given the page image and a machine transcription of the same page (Mathpix: Markdown with LaTeX). The transcription has the right characters and formulas but sometimes the wrong ORDER: the page is printed in columns and lines from two exercises can be interleaved. Use the image to restore the order.

Rules:
- Only exercises the student is asked to do: numbered questions, "Exercise I", problems, self-evaluation items, true/false or multiple-choice items. NOT activities, NOT worked examples or solved exercises, NOT lesson text, NOT summaries.
- Copy the wording exactly. Take formulas from the transcription (fix a formula only when the image clearly shows the transcription is wrong). Never translate, summarise, solve, or add anything.
- Keep every sub-part (a., b., 1), 2) ...) inside its exercise, each on its own line.
- Keep tables as Markdown tables. Math in $...$ or $$...$$.
- Text that applies to all exercises of a section (e.g. "In all exercises take g = 10 m/s^2") is an item with number "preamble".
- When one instruction is printed once for a run of numbered items ("For exercises 10 to 15, determine f^-1", "Solve in R the following equations" followed by 7., 8., 9.), copy that instruction at the start of EACH of those items, so every item can be read on its own. This is the only text you may repeat.
- Every formula, even a short one, must be inside $...$.
- If the first exercise on the page is the continuation of one started on the previous page, set continues_previous true and give the number if visible, else "".
- If the last exercise obviously continues on the next page, set continues_next true.
- section: the heading the exercise is printed under (e.g. "EXERCISES", "SELF-EVALUATION", "PROBLEMS", "TESTEZ VOS CONNAISSANCES"), or the last one you can infer.
- kind: "mcq" (choose among given options), "true_false", "open" (one question), or "problem" (several sub-parts).
- figure: true if the exercise needs a figure, graph, diagram or picture printed on the page.

Reply with JSON only: {"page_has_exercises": bool, "items": [{"section": str, "number": str, "continues_previous": bool, "continues_next": bool, "kind": str, "figure": bool, "text": str}]}"""


def words(text: str) -> list:
    """Words to check an exercise against its page: LaTeX commands removed, 3+ letters."""
    text = re.sub(r"\\[a-zA-Z]+", " ", text)
    return [w.lower() for w in re.findall(r"[^\W\d_]{3,}", text)]


def grounded(item_text: str, page_text: str) -> float:
    ws = words(item_text)
    if not ws:
        return 1.0
    bag = set(words(page_text))
    return sum(1 for w in ws if w in bag) / len(ws)


def catalog() -> dict:
    with open(CATALOG, encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    return {r["folder"]: r for r in rows}


def find_pdf(folder: str) -> Path:
    """The scanned PDF of a book, matched by sha256 — file names disagree between tracks."""
    books = json.loads((CORPUS / "books.json").read_text("utf-8"))
    want = books[folder]["sha256"]
    cache_path = OUT / "pdf-index.json"
    cache = json.loads(cache_path.read_text("utf-8")) if cache_path.exists() else {}
    for path, sha in cache.items():
        if sha == want and Path(path).exists():
            return Path(path)
    for pdf in sorted((CORPUS / "crdp ebooks").rglob("*.pdf")):
        key = str(pdf)
        if key not in cache:
            cache[key] = hashlib.sha256(pdf.read_bytes()).hexdigest()
        if cache[key] == want:
            OUT.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(cache, indent=1), "utf-8")
            return pdf
    OUT.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache, indent=1), "utf-8")
    raise SystemExit(f"{folder}: no PDF under corpus/crdp ebooks with sha256 {want[:12]}")


def page_text(folder: str, page: int) -> str:
    path = CORPUS / "text" / folder / "clean" / f"page-{page:03d}.md"
    return path.read_text("utf-8") if path.exists() else ""


def pages_of(chapter: dict) -> list:
    if chapter.get("pages"):
        return chapter["pages"]
    a = chapter.get("pdfPage")
    b = chapter.get("pdfPageEnd") or a
    return list(range(a, b + 1)) if a else []


def exercise_zone(folder: str, chapter: dict) -> tuple:
    """(pages, opening heading): from the first exercise heading to the chapter's end, in printed order."""
    order = pages_of(chapter)
    for i, page in enumerate(order):
        for line in page_text(folder, page).splitlines():
            m = HEADING.match(line)
            if m and START.search(m.group(1).strip()) and not SKIP.search(m.group(1).strip()):
                return order[i:], m.group(1).strip()
    # No heading survived: the first page in the second half dense with
    # numbered items, to the end. The model drops what is not an exercise.
    for i in range(len(order) // 2, len(order)):
        lines = page_text(folder, order[i]).splitlines()
        if sum(1 for line in lines if NUMBERED.match(line)) >= 3:
            return order[i:], "exercises"
    return [], ""


def exercise_pages(folder: str, chapter: dict) -> list:
    return exercise_zone(folder, chapter)[0]


def tidy_math(text: str) -> str:
    """\( \) and \[ \] to the $ delimiters the rest of the corpus uses."""
    text = re.sub(r"\\\[(.+?)\\\]", lambda m: "$$" + m.group(1).strip() + "$$", text, flags=re.S)
    text = re.sub(r"\\\((.+?)\\\)", lambda m: "$" + m.group(1).strip() + "$", text, flags=re.S)
    # "\\sin" is a JSON double-escape, not a line break followed by "sin".
    text = re.sub(r"(?<!\\)\\\\(?=[a-zA-Z])", r"\\", text)
    # A line of bare LaTeX ("e^{2x} + e^{x} - 2 = 0.") would print as code.
    # Only a line with no $ at all and no run of prose is wrapped.
    lines = []
    for line in text.split("\n"):
        bare = line.strip()
        if (
            bare
            and "$" not in bare
            and not bare.startswith("|")
            and re.search(r"\\[a-zA-Z]+|[\^_]\{", bare)
            and not re.search(r"[A-Za-zÀ-ÿ]{4,}\s+[A-Za-zÀ-ÿ]{4,}", re.sub(r"\\[a-zA-Z]+", " ", bare))
        ):
            line = "$" + bare + "$"
        lines.append(line)
    return "\n".join(lines)


def ask(key: str, model: str, jpeg: bytes, mathpix: str, chapter_title: str, before: str) -> tuple:
    import base64
    import urllib.request
    import time

    body = {
        "model": model,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM},
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Chapter: {chapter_title}\n\n"
                            f"The PREVIOUS page, in reading order, ended with:\n\n...{before}\n\n"
                            "If this page opens with the rest of that exercise (sub-questions such as "
                            "1), 2) or c), d) that belong to it, or its remaining text), return that "
                            "part as the first item with continues_previous true.\n\n"
                            f"Mathpix transcription of THIS page:\n\n{mathpix}"
                        ),
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode(), "detail": "high"},
                    },
                ],
            },
        ],
        "max_completion_tokens": 16000,
    }
    if model.startswith(("gpt-5", "o")):
        body["reasoning_effort"] = "low"
    request = urllib.request.Request(
        ocr_pdf.OPENAI_API,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    # Page images are token-heavy, so the per-minute limit is hit before the
    # request limit: back off long enough for the minute to roll over.
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                payload = json.load(response)
            return payload["choices"][0]["message"]["content"] or "", payload.get("usage", {})
        except Exception:  # noqa: BLE001 — retried, then raised
            if attempt == 5:
                raise
            time.sleep(20 * (attempt + 1))
    return "", {}


def assemble(folder: str, chapter: dict, pages: list, replies: dict) -> list:
    """Join the per-page items into exercises, merging those that run over a page."""
    out = []
    # Each page is read alone, so a page with no heading of its own names its
    # exercises after whatever sub-heading it can see ("COMBINATIONS"). The
    # section is therefore the last exercise heading seen, starting with the
    # one that opened the zone.
    current = exercise_zone(folder, chapter)[1] or "exercises"
    skipping = False
    for page in pages:
        reply = replies.get(page)
        if not reply:
            continue
        for item in reply.get("items") or []:
            if not isinstance(item, dict):
                continue
            text = tidy_math((item.get("text") or "").strip())
            if not text:
                continue
            # Once under a skipped heading, stay out until an exercise heading.
            section = (item.get("section") or "").strip()
            if SKIP.search(section):
                skipping = True
                continue
            if START.search(section):
                current, skipping = section, False
            elif skipping:
                continue
            number = NUMBER_WORD.sub("", str(item.get("number") or "").strip()).strip().rstrip(".")
            prev = out[-1] if out else None
            # The model's number on a continuation is often a sub-part's ("1"),
            # so a missing, equal or smaller number still merges. It also claims
            # continuation too often: a page opening on exercise 3 after
            # exercise 2 is a new exercise, whatever the flag says.
            newer = number.isdigit() and prev and prev["number"].isdigit() and int(number) > int(prev["number"])
            # And the text has to look like the rest of something: a sub-part,
            # a lower-case run-on, the same number, or a previous exercise that
            # stops mid-sentence. "Recall that a weighted point ..." is not.
            looks_continued = prev and (
                number == prev["number"]
                or FRAGMENT.match(text)
                or text[:1].islower()
                or not re.search(r"[.?!:$|)]\s*$", prev["text"])
            )
            if item.get("continues_previous") and prev and not newer and looks_continued:
                prev["text"] += "\n" + text
                prev["pageTo"] = page
                prev["pageText"] += "\n" + page_text(folder, page)
                prev["figure"] = prev["figure"] or bool(item.get("figure"))
                continue
            out.append(
                {
                    "section": current,
                    "number": number,
                    "kind": item.get("kind") or "open",
                    "figure": bool(item.get("figure")),
                    "text": text,
                    "pageFrom": page,
                    "pageTo": page,
                    "pageText": page_text(folder, page),
                    "orphan": bool(item.get("continues_previous")) or not number,
                }
            )

    # The model sometimes returns an exercise's sub-parts as items of their own:
    # "2","2","2" for 2a, 2b, 2c, or "5a","5b" after "5", or bare "a","b","c"
    # after the item holding the stem. Put them back together.
    joined = []
    for ex in out:
        prev = joined[-1] if joined else None
        n = ex["number"].lower()
        if prev and prev["section"] == ex["section"] and n and n != "preamble" and (
            n == prev["number"].lower()
            or re.fullmatch(re.escape(prev["number"].lower()) + r"\s*[-.(]?[a-h]\)?", n)
            or (re.fullmatch(r"[a-h]", n) and FRAGMENT.match(ex["text"]))
        ):
            prev["text"] += "\n" + ex["text"]
            prev["pageTo"] = ex["pageTo"]
            if ex["pageText"] not in prev["pageText"]:
                prev["pageText"] += "\n" + ex["pageText"]
            prev["figure"] = prev["figure"] or ex["figure"]
            continue
        joined.append(ex)
    out = joined

    # A preamble is copied onto every exercise of its section, then dropped.
    exercises, preamble = [], {}
    for ex in out:
        if ex["number"].lower() == "preamble":
            preamble[ex["section"]] = ex["text"]
            continue
        if ex["section"] in preamble:
            ex["text"] = preamble[ex["section"]] + "\n\n" + ex["text"]
            ex["pageText"] += "\n" + preamble[ex["section"]]
        exercises.append(ex)

    seen = {}
    final = []
    for ex in exercises:
        score = grounded(ex["text"], ex["pageText"])
        held = []
        if score < 0.85:
            held.append(f"grounding {score:.2f}")
        if ex["figure"] or FIGURE.search(ex["text"]):
            held.append("figure")
        # "1. a. Calculate ..." is a whole exercise that happens to open on a
        # sub-part. Only an unnumbered one, or one the model said continues
        # a page it could not be joined to, has lost its stem.
        # "9c" that could not be joined to a "9" is a sub-part on its own,
        # relying on points and planes defined in a stem it does not carry.
        if (FRAGMENT.match(ex["text"]) and ex["orphan"]) or re.fullmatch(r"\d+\s*[-.(]?[a-h]\)?", ex["number"]):
            held.append("fragment")
        if len(ex["text"]) < 12:
            held.append("too short")
        # "$x^{3}=27$." is item 15 of a list whose instruction ("Solve the
        # equations") was printed once above it: no question without the stem.
        elif not words(ex["text"]):
            held.append("no stem")
        slug = re.sub(r"[^a-z0-9]+", "-", ex["section"].lower()).strip("-")[:30] or "ex"
        base = f"book:{folder}:ch{chapter['index']}:{slug}:{ex['number'] or 'x'}"
        # Same section and number twice (a misread number): keep both, apart.
        seen[base] = seen.get(base, 0) + 1
        ref = base if seen[base] == 1 else f"{base}#{seen[base]}"
        final.append(
            {
                "sourceRef": ref,
                "chapterIndex": chapter["index"],
                "chapterTitle": chapter["title"],
                "section": ex["section"],
                "number": ex["number"],
                "kind": ex["kind"],
                "text": ex["text"],
                "pageFrom": ex["pageFrom"],
                "pageTo": ex["pageTo"],
                "grounding": round(score, 3),
                "held": held,
            }
        )
    return final


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--book", action="append", default=[], help="folder name; repeatable")
    ap.add_argument("--all-science", action="store_true", help="every fr/en science and maths book")
    ap.add_argument("--chapters", default="", help="chapter indices, e.g. 2 or 1-4")
    ap.add_argument("--model", default="gpt-4.1-mini")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--max-usd", type=float, default=2.0)
    ap.add_argument("--estimate", action="store_true")
    args = ap.parse_args()

    import pypdfium2 as pdfium

    price_in, price_out = PRICES.get(args.model, (None, None))
    if price_in is None:
        raise SystemExit(f"no price assumed for {args.model}; add it to PRICES first")

    cat = catalog()
    books = list(args.book)
    if args.all_science:
        # One entry per folder; the catalog repeats a few rows.
        for folder, row in cat.items():
            if row["subject"] in SCIENCE_SUBJECTS and row["language"] in ("fr", "en") and "summary" not in row["book_name"]:
                books.append(folder)
    books = list(dict.fromkeys(books))
    for folder in books:
        if cat.get(folder, {}).get("language") not in ("fr", "en"):
            raise SystemExit(f"{folder}: only French and English books are read")

    wanted = set()
    for part in filter(None, args.chapters.split(",")):
        a, _, b = part.partition("-")
        wanted.update(range(int(a), int(b or a) + 1))

    plan = []  # (folder, chapter, pages)
    for folder in books:
        taxonomy = json.loads((CORPUS / "taxonomy" / f"{folder}.json").read_text("utf-8"))
        for chapter in taxonomy["chapters"]:
            if wanted and chapter["index"] not in wanted:
                continue
            # "Self-Evaluation - Answers and Hints" holds the answers, not exercises.
            if ANSWERS.search(chapter["title"]):
                continue
            plan.append((folder, chapter, exercise_pages(folder, chapter)))

    tasks = []
    for folder, chapter, pages in plan:
        for page in pages:
            if not (OUT / "raw" / folder / f"page-{page:03d}.json").exists():
                tasks.append((folder, chapter, page))
    tasks = list({(t[0], t[2]): t for t in tasks}.values())

    no_zone = [(f, c["index"], c["title"][:40]) for f, c, p in plan if not p]
    print(f"{len(books)} book(s), {len(plan)} chapter(s), {sum(len(p) for *_, p in plan)} exercise page(s)")
    if no_zone:
        print(f"{len(no_zone)} chapter(s) with no exercise heading found:")
        for row in no_zone[:40]:
            print("   ", row)
    # Measured on the pilot: see the printed totals of a real run.
    est = len(tasks) * (4500 * price_in + 1500 * price_out) / 1e6
    print(f"{len(tasks)} page(s) still to read with {args.model}, ~${est:.2f} at assumed prices; cap ${args.max_usd:.2f}")
    if args.estimate:
        return

    key = ocr_pdf.api_key(args.model)
    docs, render_lock, tally_lock = {}, threading.Lock(), threading.Lock()
    spent = {"in": 0, "out": 0, "done": 0, "bad": []}
    stop = threading.Event()

    def usd() -> float:
        return (spent["in"] * price_in + spent["out"] * price_out) / 1e6

    def work(task):
        folder, chapter, page = task
        # The tail of the page before it in printed order, so the model can tell
        # an exercise running over from a new one. The scans are shuffled, so
        # "before" comes from the chapter's page list, not from page - 1.
        order = pages_of(chapter)
        at = order.index(page) if page in order else 0
        before = page_text(folder, order[at - 1])[-700:] if at > 0 else "(start of chapter)"
        if stop.is_set():
            return
        with render_lock:
            if folder not in docs:
                docs[folder] = pdfium.PdfDocument(str(find_pdf(folder)))
            jpeg = ocr_pdf.render(docs[folder], page - 1)
        text, usage = ask(key, args.model, jpeg, page_text(folder, page), chapter["title"], before)
        try:
            reply = json.loads(text)
        except json.JSONDecodeError:
            reply = None
        with tally_lock:
            spent["in"] += usage.get("prompt_tokens", 0)
            spent["out"] += usage.get("completion_tokens", 0)
            spent["done"] += 1
            if not isinstance(reply, dict):
                spent["bad"].append(f"{folder}/{page}")
            else:
                folder_out = OUT / "raw" / folder
                folder_out.mkdir(parents=True, exist_ok=True)
                (folder_out / f"page-{page:03d}.json").write_text(json.dumps(reply, ensure_ascii=False, indent=1), "utf-8")
            if spent["done"] % 25 == 0:
                print(f"  {spent['done']}/{len(tasks)} pages  ${usd():.2f}", flush=True)
            if usd() >= args.max_usd:
                stop.set()

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for future in as_completed([pool.submit(work, t) for t in tasks]):
            future.result()

    if tasks:
        print(f"{spent['done']} page(s) read, tokens {spent['in']} in / {spent['out']} out, ~${usd():.2f}")
    if stop.is_set():
        print(f"STOPPED at the ${args.max_usd:.2f} cap — re-run to continue")
    if spent["bad"]:
        print(f"UNREADABLE reply (re-run to retry): {spent['bad']}")

    # Assemble every book in the plan from whatever replies are on disk.
    for folder in books:
        chapters_done = []
        for f, chapter, pages in plan:
            if f != folder:
                continue
            replies = {}
            for page in pages:
                path = OUT / "raw" / folder / f"page-{page:03d}.json"
                if path.exists():
                    replies[page] = json.loads(path.read_text("utf-8"))
            chapters_done.extend(assemble(folder, chapter, pages, replies))
        target = OUT / f"{folder}.json"
        # A --chapters run adds to the file instead of replacing the other chapters.
        if wanted and target.exists():
            kept = [e for e in json.loads(target.read_text("utf-8"))["exercises"] if e["chapterIndex"] not in wanted]
            chapters_done = kept + chapters_done
        # Stable: keeps printed page order inside a chapter (the scans are shuffled).
        chapters_done.sort(key=lambda e: e["chapterIndex"])
        target.write_text(
            json.dumps({"book": folder, "model": args.model, "exercises": chapters_done}, ensure_ascii=False, indent=1),
            "utf-8",
        )
        held = [e for e in chapters_done if e["held"]]
        print(f"{folder}: {len(chapters_done)} exercises, {len(chapters_done) - len(held)} loadable, {len(held)} held")
        reasons = {}
        for e in held:
            for r in e["held"]:
                reasons[r.split()[0]] = reasons.get(r.split()[0], 0) + 1
        if reasons:
            print(f"   held because: {reasons}")


if __name__ == "__main__":
    main()
