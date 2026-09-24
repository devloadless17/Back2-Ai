# -*- coding: utf-8 -*-
"""Attach the official answers to Arabic-taught exam questions.

    python scripts/corpus/attach_answers.py --estimate
    python scripts/corpus/attach_answers.py --max-usd 3

Reads corpus/exams-arabic.json (from extract_arabic_only.py), finds each
paper's answer key in its transcription (corpus/exams-ocr/<sha8>/), and writes
each question part's answer into the same file for load-exams.ts to store as
the official solution.

WHY A MODEL, AND WHY IT CANNOT MAKE ANYTHING UP. These answer keys come in
three layouts — a real table ("| 2- أ | … | 3 |"), columns flattened into
lines ("رقم السؤال | الإجابات المقترحة | العلامة" then blocks), and a
plan per essay subject — and their row labels ("أولاً", "2- ب", "1") rarely
match the extractor's part labels. `parse_scheme` reads none of them. So the
model only does the MATCHING: it is shown the parts and the key and returns,
per part, a passage of the key. Every line of that passage must then be found
in the key, in order, with only a marking note's worth of gap between lines
(`locate`), or the passage is thrown away. What is STORED is the key's own
span from the first line to the last, never the model's copy — so an answer
is always the ministry's wording, down to the vowel marks.

Cached per paper and per the exact list of parts it was asked about, with the
model's raw reply, so a re-run costs nothing, a changed checking rule is
re-applied for free, and only a changed extraction asks again. Spend cap.
"""

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract_exams as ee  # noqa: E402
import ocr_pdf  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
EXAMS = ROOT / "corpus" / "exams-arabic.json"
OCR = ROOT / "corpus" / "exams-ocr"
CACHE = OCR / "answers"
MODEL = "gpt-4.1-mini"
PRICE_IN, PRICE_OUT = 0.40, 1.60  # USD per million tokens, ASSUMED

SYSTEM = (
    "You match an exam's official answer key to its questions. You are given the "
    "questions, each with an id, and the answer key as printed. For each question, "
    "copy the part of the answer key that answers it, EXACTLY as printed: same words, "
    "same order, no rewording, no summarising, no translation, nothing added. If the "
    "key does not answer a question, leave it out. Reply with JSON only: "
    '{"answers": {"<id>": "<verbatim passage>"}}'
)


# What a faithful copy may still differ in: spacing, a bullet or dash, a comma,
# a vowel mark, a tatweel. Compared with those removed; STORED from the key.
_NOISE = re.compile(r"[\sً-ْٰـ•●▪◦·*\-–—:.,،؛;()\[\]{}\"'|«»]")


# The most key text, in squashed characters, allowed between two consecutive
# copied lines: room for a marking note, not for a skipped question.
MAX_GAP = 120


def squash(s: str) -> str:
    return _NOISE.sub("", s or "")


def locate(passage: str, key: str) -> str | None:
    """The key's own text for a passage the model copied, or None.

    Matches with `_NOISE` removed from both, then maps the match back to the
    original characters, so what is stored is the ministry's text exactly,
    including the bullets and vowels a model copy might have dropped.
    """
    kept = [(i, ch) for i, ch in enumerate(key) if not _NOISE.match(ch)]
    flat = "".join(ch for _, ch in kept)
    # Line by line, in order. A model copying an answer drops the marking notes
    # the key prints between its lines — "3 علامة لكل فكرة", a lone "1" — and
    # a whole-passage match then rejected one answer in four that was
    # otherwise exact. Each line must still be in the key, in order, with
    # only a short gap between; the stored span runs from the first line to
    # the last, so those notes come back, in the key's own words.
    lines = [squash(line) for line in passage.split("\n")]
    lines = [line for line in lines if len(line) >= 3]
    if not lines:
        return None
    first = last = None
    at = 0
    for line in lines:
        found = flat.find(line, at)
        if found < 0 or (last is not None and found - last > MAX_GAP):
            return None
        first = found if first is None else first
        last = found + len(line)
        at = last
    return key[kept[first][0]:kept[last - 1][0] + 1].strip()


def scheme_text(sha8: str) -> str | None:
    pages = [p.read_text("utf-8") for p in sorted((OCR / sha8).glob("page-*.md"))]
    for i, page in enumerate(pages):
        if i > 0 and ee.SCHEME_HEAD.search(page[:600]):
            return "\n".join(pages[i:])
    return None


def parts_of(entry: dict) -> list:
    out = []
    for e in entry["exercises"]:
        for n, p in enumerate(e["parts"]):
            text = (p.get("text") or "").strip() or (e.get("title") or "")
            out.append((f"E{e['index']}.P{n}", p.get("label", ""), text[:220]))
    return out


def ask(key: str, parts: list, scheme: str) -> tuple:
    questions = "\n".join(f"[{pid}] {label} {text}" for pid, label, text in parts)
    body = {
        "model": MODEL,
        "response_format": {"type": "json_object"},
        "max_completion_tokens": 12000,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"QUESTIONS:\n{questions}\n\nANSWER KEY:\n{scheme[:24000]}"},
        ],
    }
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                payload = json.load(r)
            usage = payload.get("usage", {})
            text = payload["choices"][0]["message"]["content"] or "{}"
            return json.loads(text).get("answers", {}), usage
        except (OSError, json.JSONDecodeError, KeyError):
            if attempt < 3:
                time.sleep(4 * (attempt + 1))
                continue
            raise
    return {}, {}


def validate(raw: dict, parts: list, scheme: str) -> tuple:
    """Keep the passages that are the key's own text; return them and the counts."""
    valid_ids = {pid for pid, _, _ in parts}
    answers, rejected = {}, 0
    for pid, passage in (raw or {}).items():
        original = locate(passage, scheme) if pid in valid_ids and isinstance(passage, str) else None
        if original:
            answers[pid] = original
        else:
            rejected += 1
    return answers, len(answers), rejected


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-usd", type=float, default=3.0)
    ap.add_argument("--estimate", action="store_true")
    args = ap.parse_args()

    rows = json.loads(EXAMS.read_text("utf-8"))
    by_sha = {}
    for r in rows:
        by_sha.setdefault(r["sha256"][:8], r)
    CACHE.mkdir(parents=True, exist_ok=True)

    todo, results = [], {}
    no_key = 0
    for sha8, entry in by_sha.items():
        scheme = scheme_text(sha8)
        parts = parts_of(entry)
        if not scheme or not parts:
            no_key += 1
            continue
        sig = hashlib.sha256(json.dumps(parts, ensure_ascii=False).encode()).hexdigest()[:16]
        cached = CACHE / f"{sha8}.json"
        if cached.exists():
            data = json.loads(cached.read_text("utf-8"))
            if data.get("sig") == sig and "raw" in data:
                results[sha8] = validate(data["raw"], parts, scheme)[0]
                continue
        todo.append((sha8, parts, scheme, sig))

    est = sum((len(s[:24000]) + 4000) / 2.2 * PRICE_IN + 2500 * PRICE_OUT for _, _, s, _ in todo) / 1e6
    print(f"{len(by_sha)} papers, {no_key} with no answer key found, {len(results)} cached, {len(todo)} to ask")
    print(f"estimated ~${est:.2f} (assumed prices), cap ${args.max_usd:.2f}")
    if args.estimate:
        return

    import threading
    from concurrent.futures import ThreadPoolExecutor

    key = ocr_pdf.api_key(MODEL)
    lock = threading.Lock()
    tally = {"spent": 0.0, "kept": 0, "rejected": 0, "done": 0}

    # A long answer key takes the model a minute to copy out, so papers are
    # asked eight at a time; one at a time was three hours for 256 papers.
    def work(item):
        sha8, parts, scheme, sig = item
        if tally["spent"] >= args.max_usd:
            return
        raw, usage = ask(key, parts, scheme)
        answers, kept, rejected = validate(raw, parts, scheme)
        (CACHE / f"{sha8}.json").write_text(
            json.dumps({"sig": sig, "raw": raw, "answers": answers}, ensure_ascii=False), "utf-8"
        )
        with lock:
            results[sha8] = answers
            tally["spent"] += (usage.get("prompt_tokens", 0) * PRICE_IN + usage.get("completion_tokens", 0) * PRICE_OUT) / 1e6
            tally["kept"] += kept
            tally["rejected"] += rejected
            tally["done"] += 1
            if tally["done"] % 20 == 0:
                print(f"  {tally['done']}/{len(todo)}  ${tally['spent']:.2f}", flush=True)

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(work, todo))
    if tally["spent"] >= args.max_usd:
        print(f"STOPPED at the ${args.max_usd:.2f} cap — re-run to continue")
    spent, kept, rejected = tally["spent"], tally["kept"], tally["rejected"]

    # Write the answers into every entry of the paper (a paper filed under two
    # tracks is two entries with the same parts).
    attached = 0
    for r in rows:
        answers = results.get(r["sha256"][:8], {})
        for e in r["exercises"]:
            for n, p in enumerate(e["parts"]):
                a = answers.get(f"E{e['index']}.P{n}")
                if a and not p.get("answer"):
                    p["answer"] = a
                    attached += 1
        r["answersFound"] = sum(1 for e in r["exercises"] for p in e["parts"] if p.get("answer"))
    EXAMS.write_text(json.dumps(rows, ensure_ascii=False), "utf-8")
    print(f"\nspent ~${spent:.2f}; passages kept {kept}, rejected as not verbatim {rejected}; "
          f"answers attached across all entries {attached}")


if __name__ == "__main__":
    main()
