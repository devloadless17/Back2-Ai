# -*- coding: utf-8 -*-
"""Reads an Arabic marking scheme with a model, and pins every answer to the page.

NOT IN USE. It works, and its output is not safe to store yet — see WHY IT IS
SHELVED at the end of this docstring before running it.

    python scripts/corpus/read_schemes_ai.py --estimate
    python scripts/corpus/read_schemes_ai.py --subject arabic --limit 3
    python scripts/corpus/read_schemes_ai.py --max-usd 2

جغرافيا, أدب عربي and تربية وطنية hold **zero** official answers, against
physics at 48% — not because the keys are missing but because they are prose.
`parse_scheme` reads a ruled three-column table; these papers print

    عناصر الإجابة ومعاييرها
    أولاً: في الفهم والتحليل
    - هويةُ الصفة: اسمها وسماتها ... (ربع علامة)

and 47 of 95 civics papers print marking prose with no header above it at all.
Widening `SCHEME_HEAD` to reach them was tried and reverted the same hour: it
split the paper earlier, cost gs/2009 1/arabe.pdf three of its four exercises,
and still produced no answers, because finding the boundary hands `parse_scheme`
something it cannot parse either way. The splitter's own docstring says as much:
"Fix the reader first; the split is downstream of it."

So this is the reader. A model reads the scheme and says which exercise each
answer belongs to.

THE ONLY THING THAT MAKES THIS SAFE IS THE VERBATIM CHECK. An answer key bound
to the wrong question is a confident wrong answer shown to an exam candidate,
which is the failure this whole extractor is arranged to avoid — so the model is
never trusted for CONTENT, only for ALIGNMENT. It must return each answer as an
exact span of the scheme text it was given, and every returned span is then
checked to occur in that text, character for character after whitespace folding.
A span that is not found is discarded and counted. The model cannot invent an
answer that survives, because an invented answer is not in the page.

It is also not trusted for MARKS. Nothing here writes a barème; the marks in
these schemes are recovered by the existing rules or not at all.

Output is a sidecar per paper, `corpus/scheme-answers/<sha8>.json`, read by
`extract_exams.py` the same way it reads an OCR transcription — so the answers
flow through the ordinary pipeline and a re-extraction does not lose them.

WHY IT IS SHELVED. The guards work: on four papers they kept 10 answers, threw
away 1 the model had written rather than copied, and 5 that numbered an exercise
the paper does not have. Then the answers were read against their questions by
hand, which is the one check no guard here performs, and only about two in eight
were genuinely the answer to the exercise they were filed under. One paper had a
question about technological innovation answered with a passage on heredity.

The cause is structural and no prompt fixes it. For these papers
`extract_exams.py` produces ONE exercise per paper — a blob holding numbered
sub-questions — while the marking scheme answers those sub-questions
individually. There is no one-to-one mapping to find, so "which exercise does
this answer belong to" has no true answer, and the model returns whichever span
it met first. The five rejected indices were the same fact seen from the other
side: the model kept numbering sub-questions because that is how the scheme is
organised. It was describing the document correctly and the schema was wrong.

The prerequisite is the one the splitter's own docstring states for
`parse_scheme`: fix the reader first. Here that means extracting the
sub-questions of these papers as addressable parts. Until they are addressable,
storing this output would put a right answer on the wrong question — the failure
the verbatim check exists to prevent, arriving through a door it does not watch.
"""

import argparse
import hashlib
import json
import os
import pathlib
import re
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXAMS = ROOT / "corpus" / "exams"
OUT = ROOT / "corpus" / "scheme-answers"
OPENAI_API = "https://api.openai.com/v1/chat/completions"

# The header these subjects print above the key, and the marking prose the
# civics papers print instead of a header.
KEY_HEADER = re.compile(r"عناصر\s*ال[أإا]?جابة|أسس\s*ال?تصحيح|سلّ?م\s*ال?تصحيح|الإجابة\s*النموذجية")
KEY_PROSE = re.compile(r"المطلوب\s+\S+\s*،?\s*(?:نصف|ربع|علامة)|لكل\s+(?:شرط|فكرة|عنصر)")

SUBJECTS = {
    "arabic": re.compile(r"(?:^|[\s_-])arabe", re.I),
    "geography": re.compile(r"(?:^|[\s_-])geo", re.I),
    "civics": re.compile(r"(?:^|[\s_-])tarbeya", re.I),
    "history": re.compile(r"(?:^|[\s_-])(?:tarekh|terekh|history)", re.I),
}
ACCOMMODATION = re.compile(r"ehteyejet|ehtiyejet|makfoufen|makfufin|mu5tasa", re.I)

PROMPT = """You are given the MARKING SCHEME of a Lebanese Baccalaureate paper, and the list of exercises on that paper.

For each exercise, find the part of the marking scheme that answers it.

Rules you must follow exactly:
1. Copy the answer VERBATIM from the marking scheme. Do not paraphrase, summarise, translate, correct or complete it. Copy the characters as they appear.
2. If you cannot find an answer for an exercise, omit that exercise. Do not guess.
3. Do not write anything that is not in the marking scheme.

Reply with JSON only: {"answers":[{"exercise":<number>,"answer":"<verbatim span>"}]}"""


def fold(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def key_text(pages: list) -> str:
    """The scheme half of the paper: from the first page that looks like a key."""
    for i, page in enumerate(pages):
        head = page[:600]
        if KEY_HEADER.search(head) or KEY_PROSE.search(head):
            return "\n".join(pages[i:])
    joined = "\n".join(pages)
    m = KEY_HEADER.search(joined) or KEY_PROSE.search(joined)
    return joined[m.start():] if m else ""


def ask(key: str, model: str, scheme: str, exercises: list) -> tuple:
    listing = "\n".join(
        "Exercise %d: %s" % (e["index"], fold(e["statement"])[:400]) for e in exercises)
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": PROMPT},
            {"role": "user", "content": "MARKING SCHEME:\n%s\n\nEXERCISES:\n%s" % (scheme[:60000], listing)},
        ],
        "response_format": {"type": "json_object"},
    }
    request = urllib.request.Request(
        OPENAI_API, data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer %s" % key, "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = json.loads(response.read().decode())
    text = payload["choices"][0]["message"]["content"]
    usage = payload.get("usage", {})
    return json.loads(text), (usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="gpt-5.4-mini")
    ap.add_argument("--subject", default=None, choices=sorted(SUBJECTS))
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--max-usd", type=float, default=2.0)
    ap.add_argument("--estimate", action="store_true")
    args = ap.parse_args()

    sys.path.insert(0, str(ROOT / "scripts" / "corpus"))
    import extract_exams as X
    X.NO_TABLES = True

    wanted = [SUBJECTS[args.subject]] if args.subject else list(SUBJECTS.values())
    papers = []
    for pdf in sorted(EXAMS.rglob("*.pdf")):
        if ACCOMMODATION.search(pdf.name):
            continue
        if not any(rx.search(pdf.name) for rx in wanted):
            continue
        if re.search(r"_(fr|en|eng)\.pdf$", pdf.name, re.I):
            continue
        papers.append(pdf)

    print("  %d candidate paper(s)" % len(papers))
    if args.estimate:
        # Measured: a scheme runs ~6,000 tokens in and ~1,200 out on the mini model.
        print("  ~$%.2f on %s" % (len(papers) * (6000 * 0.75 + 1200 * 4.5) / 1e6, args.model))
        return

    key = os.environ.get("OPENAI_API_KEY", "")
    if not key:
        print("  OPENAI_API_KEY is not set"); return
    OUT.mkdir(parents=True, exist_ok=True)

    spent = 0.0
    kept = not_in_page = no_such_exercise = done = 0
    for n, pdf in enumerate(papers, start=1):
        if spent >= args.max_usd:
            print("  STOPPED at $%.2f, the --max-usd limit. %d of %d done." % (spent, n - 1, len(papers)))
            break
        sha = hashlib.sha256(pdf.read_bytes()).hexdigest()[:8]
        out = OUT / ("%s.json" % sha)
        if out.exists():
            continue
        row = X.read(pdf)
        if not row or "error" in row:
            continue
        exercises = row.get("exercises") or []
        if not exercises:
            continue

        import pypdf
        pages = X.ocr_pages(pdf)
        if pages is None:
            try:
                pages = [(p.extract_text() or "") for p in pypdf.PdfReader(str(pdf)).pages]
            except Exception:
                continue
        scheme = key_text([str(p) for p in pages])
        # Papers without a key are skipped WITHOUT counting against --limit:
        # the limit is there to bound spend, and a skipped paper costs nothing.
        if len(scheme.strip()) < 300:
            continue
        if args.limit and done >= args.limit:
            print("  reached --limit %d paper(s) with a scheme" % args.limit)
            break

        try:
            reply, (tin, tout) = ask(key, args.model, scheme, exercises)
        except Exception as err:
            print("  [%d/%d] FAIL %s — %s" % (n, len(papers), pdf.name, str(err)[:60]))
            continue
        spent += (tin * 0.75 + tout * 4.5) / 1e6

        # THE GUARD. An answer survives only if it is in the page it came from.
        folded = fold(scheme)
        # The exercise numbers this paper actually has. gs/2012 2/arabe.pdf has
        # two exercises and the model returned answers numbered 1 to 5 — it had
        # numbered the SUB-QUESTIONS. An index that names no exercise is not a
        # near miss to be tolerated; it would attach an answer to whatever the
        # loader made of that number, which is the wrong-answer-on-the-wrong-
        # question failure this whole file is built to prevent.
        valid = {int(e["index"]) for e in exercises if str(e.get("index", "")).isdigit()}
        answers = {}
        for item in reply.get("answers", []):
            try:
                idx = int(item.get("exercise"))
            except (TypeError, ValueError):
                continue
            span = fold(str(item.get("answer", "")))
            if len(span) < 40:
                continue
            if idx not in valid:
                no_such_exercise += 1
                continue
            if span in folded:
                answers[idx] = span
                kept += 1
            else:
                not_in_page += 1

        if answers:
            out.write_text(json.dumps(
                {"paper": str(pdf.relative_to(EXAMS)), "sha8": sha, "answers": answers},
                ensure_ascii=False, indent=1), encoding="utf-8")
            done += 1
        print("  [%d/%d] %-34s exercises=%-3d kept=%-3d not-in-page=%-3d no-such-ex=%-3d $%.2f"
              % (n, len(papers), str(pdf.relative_to(EXAMS))[:34], len(exercises),
                 len(answers), not_in_page, no_such_exercise, spent))

    print("\n  %d paper(s) written to %s" % (done, OUT))
    print("  %d answer(s) kept" % kept)
    print("  %d discarded: not a verbatim span of the scheme (the model wrote it)" % not_in_page)
    print("  %d discarded: numbered an exercise the paper does not have" % no_such_exercise)


if __name__ == "__main__":
    main()
