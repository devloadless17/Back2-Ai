# -*- coding: utf-8 -*-
"""Attach the official answers to the science exam questions, from Mathpix's reading of the key.

    python scripts/corpus/attach_science_answers.py --estimate
    python scripts/corpus/attach_science_answers.py --match "^ls/.*bio" --max-usd 0.5
    python scripts/corpus/attach_science_answers.py --max-usd 2.5

WHY. 47 of 70 LS biology papers print their answer key after the questions,
and Mathpix read those pages, but only 11 of 1,522 sub-questions carry an
answer: nothing ever matched a key's rows to the parts. The tutor then had no
official solution and refused the course knowledge a question examines.
attach_answers.py does this for the Arabic-taught subjects from their OCR;
this is the science version, reading Mathpix's page text.

THE MODEL NEVER WRITES AN ANSWER. The key's lines are numbered and the model
returns, per part, a range of line numbers ("2-a: lines 14-17"). What is
stored is those lines of the key, verbatim — the ministry's wording and its
marks, never a paraphrase. A bad range can put the right text on the wrong
part, which is why a sample is read by eye before anything is loaded.

Which pages are the key: the extractor's own split (pages after `paperPages`)
when it found one; otherwise pages after the first that are dense with mark
notations — "(1pt)", "(½ pt)", "2 pts" — which the questions never are.

Cached per paper and per the exact prompt, so a re-run costs nothing.
Spend cap. Output: corpus/science-answers.json for load-science-answers.ts.
Arabic editions of science papers are never read.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract_exams as ee  # noqa: E402
import ocr_pdf  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "corpus"
OUT = CORPUS / "science-answers.json"
CACHE = CORPUS / "science-answers-cache"
MODEL = "gpt-4.1-mini"
PRICE_IN, PRICE_OUT = 0.40, 1.60  # USD per million tokens, assumed as elsewhere in this folder
SCIENCE = {"physics", "chemistry", "maths", "biology"}
ARABIC_EDITION = re.compile(r"(_ar\b|_ar[._]|arab|_dr\.pdf|_ar\.pdf)", re.I)
MARK = re.compile(r"\(\s*\$?\s*\\?(?:frac\{\d\}\{\d\}|\d+(?:[.,]\d+)?)\s*\\?(?:mathrm\{)?\s*pts?\b|\b\d+(?:[.,]\d+)?\s*pts?\b|½\s*pt|¼\s*pt|¾\s*pt", re.I)
MAX_LINES = 450

SYSTEM = """You match the official answer key of a Lebanese Baccalaureate science exam to the exam's sub-questions.

You get the list of sub-questions (id, label, start of its text) and the answer key with NUMBERED lines.
For each sub-question, give the range of key lines that is its official answer: {"id": ..., "from": first line number, "to": last line number}.
Rules:
- Use the key's own labels and order (e.g. "Question II", "b-", "2.a", "1)") and the content to decide.
- A range covers only that sub-question's answer, including its marks note if it sits on those lines.
- If the key has no answer for a sub-question, give {"id": ..., "from": null, "to": null}.
- Never invent or rewrite text: you only give line numbers.
Reply with JSON only: {"answers": [ ... one object per sub-question ... ]}"""


def science_papers(match: str | None):
    for p in json.loads((CORPUS / "exams.json").read_text("utf-8")):
        path = p["path"].replace("\\", "/")
        if ee.profile_for(p["path"]) not in SCIENCE or ARABIC_EDITION.search(os.path.basename(path)):
            continue
        if match and not re.search(match, path, re.I):
            continue
        if not (CORPUS / "text" / p["sha256"]).is_dir():
            continue
        yield p


def key_lines(p) -> list[str]:
    folder = CORPUS / "text" / p["sha256"]
    pages = sorted(folder.glob("page-*.md"))
    if not pages:
        return []
    texts = [f.read_text("utf-8") for f in pages]
    if p.get("schemePages") and p.get("paperPages"):
        chosen = texts[p["paperPages"]:]
    else:
        # No split found: the key is the pages dense with mark notes, never page 1.
        chosen = [t for i, t in enumerate(texts) if i > 0 and len(MARK.findall(t)) >= 3]
    lines = [ln.rstrip() for t in chosen for ln in t.splitlines() if ln.strip()]
    return lines[:MAX_LINES]


def items_of(p) -> list[dict]:
    out = []
    for order, ex in enumerate(p["exercises"]):
        parts = ex.get("parts") or []
        if not parts:
            out.append({"id": f"{order}.x", "label": ex.get("title") or f"exercise {order + 1}", "text": (ex.get("statement") or "")[:140]})
        for k, pt in enumerate(parts):
            out.append({"id": f"{order}.{k}", "label": f"exercise {order + 1} ({ex.get('title') or ''}) {pt.get('label') or ''}".strip(), "text": (pt.get("text") or "")[:140]})
    return out


def ask(key: str, items: list[dict], lines: list[str]) -> tuple[dict, dict]:
    numbered = "\n".join(f"{i + 1}: {ln}" for i, ln in enumerate(lines))
    subq = "\n".join(f"- id {it['id']} | {it['label']} | {it['text']}" for it in items)
    body = {
        "model": MODEL,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"SUB-QUESTIONS:\n{subq}\n\nANSWER KEY (numbered lines):\n{numbered}"},
        ],
        "max_completion_tokens": 4000,
    }
    req = urllib.request.Request(
        ocr_pdf.OPENAI_API, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    import time
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                payload = json.load(r)
            return json.loads(payload["choices"][0]["message"]["content"] or "{}"), payload.get("usage", {})
        except (urllib.error.HTTPError, OSError, json.JSONDecodeError):
            if attempt == 4:
                raise
            time.sleep(15 * (attempt + 1))
    return {}, {}


def tidy(answer: str) -> str:
    """The key's own words, without the table and list markup Mathpix wraps them in.

    Many keys are ruled tables, read as "\\hline 5 & <answer> & 1 \\\\": the
    cells are kept, the markup goes, and a last cell that is a bare number is
    shown as the mark it is. Nothing inside a cell is changed.
    """
    out = []
    for line in answer.split("\n"):
        s = re.sub(r"\\(?:hline|begin\{(?:tabular|itemize|enumerate)\}(?:\[[^\]]*\])?(?:\{[^}]*\})?|end\{(?:tabular|itemize|enumerate)\})", "", line)
        s = re.sub(r"\\item\[([^\]]*)\]", r"\1", s)
        s = re.sub(r"\\\\\s*$", "", s).strip()
        s = re.sub(r"\\multirow\{[^}]*\}\{[^}]*\}\{([^}]*)\}", r"\1", s)
        s = re.sub(r"\\multicolumn\{[^}]*\}\{[^}]*\}\{([^}]*)\}", r"\1", s)
        # Mathpix's own figure files are not in the app; say where the drawing is.
        s = re.sub(r"!\[[^\]]*\]\([^)]*\)", "(figure in the official answer)", s)
        s = re.sub(r"</?smiles>", "", s)
        s = re.sub(r"^&\s*", "", s).strip()
        # A line that is nothing but table plumbing, or a stray row of cells
        # with no words in it, belongs to no answer.
        if re.fullmatch(r"\\(?:end|begin)\{[a-z*]+\}.*|[&\s]*", s):
            continue
        if " & " in s:
            cells = [c.strip() for c in s.split(" & ")]
            if len(cells) >= 2 and re.fullmatch(r"\$?\s*(?:\d+(?:[.,]\d+)?|\d/\d|\\frac\{\d\}\{\d\})\s*\$?", cells[-1] or "x"):
                cells[-1] = f"({cells[-1]} pt)"
            s = " — ".join(c for c in cells if c)
        if s:
            out.append(s)
    return "\n".join(out)


LEADING_LABEL = re.compile(r"^\W*(?:(?:question|exercise|exercice|partie|part)\s*)?([A-D](?=[\s.\-–)]))?\W*(\d+(?:\s*[.\-–]\s*\d+)*)\s*[-.)]?\s*([a-h])?(?![a-z])", re.I)


def label_key(label: str) -> str:
    """"B.4" -> "4", "3-1" -> "31", "1.2" -> "12", "2.a" / "2-a" / "2a" -> "2a"."""
    m = LEADING_LABEL.match(label or "")
    if not m:
        return ""
    return re.sub(r"\D", "", m.group(2) or "") + (m.group(3) or "").lower()


def labels_agree(part_label: str, answer: str) -> bool:
    """False when the answer names a sub-question and it is not this one.

    A wrong range is the one way this matcher goes wrong, and it shows: the
    audit found "B.4 Trouver une primitive" given the key's "5a / 5b", and
    "2.4 pKa graphically" given "3.2". Both keys print their own label. An
    answer that prints none is kept; one that prints a different one is not.
    """
    first = next((ln for ln in answer.split("\n") if ln.strip()), "")
    got, want = label_key(first), label_key(part_label)
    if not got or not want:
        return True
    return got == want or got.startswith(want) or want.endswith(got) or want.startswith(got)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-usd", type=float, default=0.5)
    ap.add_argument("--estimate", action="store_true")
    ap.add_argument("--match", default=None, help="only papers whose path matches this regex")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--keep-mismatched", action="store_true",
                    help="keep answers whose printed label differs from the part's; marked unchecked")
    args = ap.parse_args()

    jobs, seen = [], set()
    for p in science_papers(args.match):
        if p["sha256"] in seen:
            continue
        seen.add(p["sha256"])
        lines, items = key_lines(p), items_of(p)
        if len(lines) < 5 or not items:
            continue
        digest = hashlib.sha256(json.dumps([SYSTEM, MODEL, lines, items], ensure_ascii=False).encode()).hexdigest()[:16]
        jobs.append((p, lines, items, CACHE / f"{p['sha256'][:12]}-{digest}.json"))

    todo = [j for j in jobs if not j[3].exists()]
    tokens = sum((sum(len(l) for l in j[1]) + sum(len(i["text"]) + 40 for i in j[2])) // 3 + 400 for j in todo)
    est = tokens * PRICE_IN / 1e6 + len(todo) * 250 * PRICE_OUT / 1e6
    print(f"{len(jobs)} papers with a readable key, {len(todo)} still to ask, ~{tokens} input tokens, ~${est:.2f}; cap ${args.max_usd:.2f}")
    if args.estimate:
        return

    CACHE.mkdir(parents=True, exist_ok=True)
    key = ocr_pdf.api_key(MODEL)
    spent = {"in": 0, "out": 0}

    def usd():
        return (spent["in"] * PRICE_IN + spent["out"] * PRICE_OUT) / 1e6

    def work(job):
        p, lines, items, cache = job
        if usd() >= args.max_usd:
            return "capped"
        reply, usage = ask(key, items, lines)
        spent["in"] += usage.get("prompt_tokens", 0)
        spent["out"] += usage.get("completion_tokens", 0)
        cache.write_text(json.dumps({"paper": p["path"], "reply": reply}, ensure_ascii=False), "utf-8")
        return "ok"

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = [f.result() for f in as_completed([pool.submit(work, j) for j in todo])]
    if todo:
        print(f"asked {results.count('ok')}, capped {results.count('capped')}, ~${usd():.3f} spent")

    # Assemble from the cache: verbatim key lines, never the model's text.
    out, stats = [], {"parts": 0, "answered": 0, "rejected_range": 0, "label_mismatch": 0}
    for p, lines, items, cache in jobs:
        if not cache.exists():
            continue
        reply = json.loads(cache.read_text("utf-8")).get("reply") or {}
        byid = {str(a.get("id")): a for a in reply.get("answers", []) if isinstance(a, dict)}
        exercises = []
        for order, ex in enumerate(p["exercises"]):
            parts_out = []
            ids = [f"{order}.x"] if not ex.get("parts") else [f"{order}.{k}" for k in range(len(ex["parts"]))]
            labels = [ex.get("title") or ""] if not ex.get("parts") else [pt.get("label") or "" for pt in ex["parts"]]
            for iid, label in zip(ids, labels):
                stats["parts"] += 1
                a = byid.get(iid) or {}
                lo, hi = a.get("from"), a.get("to")
                answer, unchecked = None, False
                if isinstance(lo, int) and isinstance(hi, int):
                    if 1 <= lo <= hi <= len(lines) and hi - lo <= 60:
                        answer = tidy("\n".join(lines[lo - 1:hi]))
                        if answer and not labels_agree(label, answer):
                            stats["label_mismatch"] += 1
                            if args.keep_mismatched:
                                unchecked = True
                            else:
                                answer = None
                        else:
                            stats["answered"] += 1
                    else:
                        stats["rejected_range"] += 1
                part = {"label": label, "answer": answer}
                if unchecked:
                    # The key printed another label here. Kept on request, unverified.
                    part["unchecked"] = True
                parts_out.append(part)
            exercises.append({"order": order, "index": ex["index"], "parts": parts_out})
        out.append({"paper": p["path"], "sha256": p["sha256"], "exercises": exercises})
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), "utf-8")
    print(f"{len(out)} papers -> {OUT.name}: {stats['answered']} of {stats['parts']} parts answered, {stats['rejected_range']} bad ranges and {stats['label_mismatch']} label mismatches "
          f"{'kept, marked unchecked' if args.keep_mismatched else 'dropped'}")


if __name__ == "__main__":
    main()
