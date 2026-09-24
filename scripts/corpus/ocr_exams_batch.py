# -*- coding: utf-8 -*-
"""OCR every Arabic-taught exam paper whose own text layer cannot be trusted.

    python scripts/corpus/ocr_exams_batch.py --estimate
    python scripts/corpus/ocr_exams_batch.py --max-usd 12

The PDFs print fine but their text layer is wrong: words out of order, vowel
marks torn off their letters, brackets flipped, ھ for ه. Reading the page as an
image sidesteps all of it. See ocr_pdf.py for the per-page reader this reuses.

Each unique file is read once. GS and LS sit the same Arabic paper, so the
same PDF sits under both tracks; keyed by sha256, it is paid for once.

Output: corpus/exams-ocr/<sha8>/page-NNN.md, and corpus/exams-ocr/index.json
mapping every exam PDF path to its sha8. Resumes: a page on disk is skipped,
and an empty reply is never written, so a re-run retries it.

--max-usd stops the run once the spend (at the prices below) reaches the cap.
The prices are assumptions, not read from anywhere: check them.
"""

import argparse
import glob
import hashlib
import json
import os
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ocr_pdf  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
EXAMS = ROOT / "corpus" / "exams"
OUT = ROOT / "corpus" / "exams-ocr"

# Arabic-taught subjects, by the filename conventions of corpus/exams.
#
# SEARCHED ANYWHERE IN THE NAME, not anchored at the start. The first version
# was anchored and missed 72 papers: from 2021 the ministry's files are named
# `SVSG_Geo_2021_1.pdf` / `SE_Eco_2024_1_Ar.pdf`, and 2004–2006 ones
# `gs geo 1.pdf`, none of which begin with the subject.
SUBJECT = re.compile(
    r"(arab|falsaf|philo|tarbeya|tarbia|geo|greo|ektesad|eqtesad|eco|ejteme|ejtema|socio)", re.I
)
# History was transcribed by hand (exams_history_lh/*.json), a better source.
HISTORY = re.compile(r"(tarekh|terekh|tarikh|histo)", re.I)
# French/English editions, including `SE_Eco_2021_1_Fr_0.pdf`.
TRANSLATED = re.compile(r"[_-](fr|en|eng)(?:_\d+)?\.pdf$", re.I)
# Accommodation editions (special-needs sittings) are not part of the corpus.
ACCOMMODATION = re.compile(r"(ehteyejet|makfofen|makfufin|mokhtasa)", re.I)
# Arabic editions of science papers are out of scope, full stop:
# `lh/2018 1/phy_arabe.pdf` matches "arab" and must not be read.
SCIENCE = re.compile(r"(phy|chim|chem|bio|svt|math|riyad)", re.I)

# USD per million tokens. ASSUMED — confirm on the provider's pricing page.
PRICES = {"gpt-4.1-mini": (0.40, 1.60), "gpt-5.5": (5.0, 30.0)}


def exam_pdfs() -> list:
    out = []
    for path in glob.glob(str(EXAMS / "**" / "*.pdf"), recursive=True):
        name = os.path.basename(path)
        if (
            SUBJECT.search(name)
            and not HISTORY.search(name)
            and not TRANSLATED.search(name)
            and not ACCOMMODATION.search(name)
            and not SCIENCE.search(name)
        ):
            out.append(Path(path))
    return sorted(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="gpt-4.1-mini")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--max-usd", type=float, default=12.0)
    ap.add_argument("--estimate", action="store_true")
    args = ap.parse_args()

    import pypdfium2 as pdfium

    price_in, price_out = PRICES.get(args.model, (None, None))
    if price_in is None:
        raise SystemExit(f"no price assumed for {args.model}; add it to PRICES first")

    pdfs = exam_pdfs()
    index, unique = {}, {}
    for path in pdfs:
        sha = hashlib.sha256(path.read_bytes()).hexdigest()[:8]
        index[path.relative_to(ROOT).as_posix()] = sha
        unique.setdefault(sha, path)

    tasks = []
    for sha, path in unique.items():
        count = len(pdfium.PdfDocument(str(path)))
        for n in range(count):
            if not (OUT / sha / f"page-{n + 1:03d}.md").exists():
                tasks.append((sha, path, n))

    pages_total = sum(len(pdfium.PdfDocument(str(p))) for p in unique.values())
    print(f"{len(pdfs)} exam PDFs, {len(unique)} unique files, {pages_total} unique pages")
    print(f"{len(tasks)} pages still to read with {args.model}")
    # Measured on this corpus with gpt-4.1-mini: ~3.3k in, ~1.0k out per page.
    est = len(tasks) * (3300 * price_in + 1000 * price_out) / 1e6
    print(f"estimated cost ~${est:.2f} (at assumed prices); cap ${args.max_usd:.2f}")

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False), "utf-8")
    if args.estimate:
        return

    key = ocr_pdf.api_key(args.model)
    render_lock, tally_lock = threading.Lock(), threading.Lock()
    docs = {}
    spent = {"in": 0, "out": 0, "done": 0, "empty": [], "thin": []}
    stop = threading.Event()

    def usd() -> float:
        return (spent["in"] * price_in + spent["out"] * price_out) / 1e6

    def work(task):
        sha, path, n = task
        if stop.is_set():
            return
        # pypdfium2 is not thread-safe: render one page at a time.
        with render_lock:
            if sha not in docs:
                docs[sha] = pdfium.PdfDocument(str(path))
            jpeg = ocr_pdf.render(docs[sha], n)
        text, usage = ocr_pdf.read_page(key, args.model, jpeg)
        text = re.sub(r"^```[a-z]*\n|\n```$", "", (text or "").strip())
        with tally_lock:
            spent["in"] += usage.get("prompt_tokens", 0)
            spent["out"] += usage.get("completion_tokens", 0)
            spent["done"] += 1
            if not text:
                spent["empty"].append(f"{sha}/{n + 1}")
            else:
                if text != "[blank page]" and len(ocr_pdf.ARABIC.findall(text)) < 40:
                    spent["thin"].append(f"{sha}/{n + 1}")
                folder = OUT / sha
                folder.mkdir(parents=True, exist_ok=True)
                (folder / f"page-{n + 1:03d}.md").write_text(text + "\n", encoding="utf-8")
            if spent["done"] % 25 == 0:
                print(f"  {spent['done']}/{len(tasks)} pages  ${usd():.2f}", flush=True)
            if usd() >= args.max_usd:
                stop.set()

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for future in as_completed([pool.submit(work, t) for t in tasks]):
            future.result()

    print()
    print(f"{spent['done']} page(s) read, tokens {spent['in']} in / {spent['out']} out, ~${usd():.2f}")
    if stop.is_set():
        print(f"STOPPED at the ${args.max_usd:.2f} cap — re-run to continue")
    if spent["empty"]:
        print(f"FAILED (empty, re-run to retry): {spent['empty']}")
    if spent["thin"]:
        print(f"CHECK by eye (little Arabic came back): {spent['thin']}")


if __name__ == "__main__":
    main()
