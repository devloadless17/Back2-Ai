# -*- coding: utf-8 -*-
"""Reads a PDF whose own text layer cannot be trusted, using a vision model.

    python scripts/corpus/ocr_pdf.py --pdf "corpus/tarikh.pdf" --name history-all --estimate
    python scripts/corpus/ocr_pdf.py --pdf "corpus/tarikh.pdf" --name history-all
    python scripts/corpus/ocr_pdf.py --pdf "corpus/tarikh.pdf" --name history-all --pages 1-5

Most books in this corpus were read by Google Document AI and arrived as JSON.
This is for the ones that did not, and specifically for a PDF that *has* a text
layer which is quietly wrong — the history book maps ث to ا and ش to a space, so
`مباشراً` extracts as `مبا ييرار`. Text like that is worse than no text: it looks
readable, it embeds without complaint, and it retrieves nonsense.

Costs money, so:

  * `--estimate` prints the bill and writes nothing.
  * every page is written as it is read, and a page already on disk is skipped,
    so an interrupted run resumes instead of paying twice.
  * the model is told to transcribe and nothing else. A vision model asked to
    read a page will happily describe it instead, and a page of description
    reads plausibly while being entirely invented. Any page that comes back
    with too little Arabic for its size is flagged rather than saved silently.
"""

import argparse
import base64
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEXT = ROOT / "corpus" / "text"

API = "https://api.openai.com/v1/chat/completions"
SCALE = 2  # ~150 dpi; enough for printed Arabic without inflating the image bill

SYSTEM = (
    "You transcribe scanned textbook pages. Reproduce the page's text exactly as printed, "
    "in its own language and reading order. Keep headings on their own lines. "
    "Do not translate, summarise, explain, or describe the page. Do not add commentary, "
    "notes or markdown fences. If the page is blank, reply with exactly: [blank page]"
)

ARABIC = re.compile(r"[؀-ۿ]")


def api_key() -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("OPENAI_API_KEY"):
            return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("OPENAI_API_KEY not found in .env")


def render(pdf, index: int) -> bytes:
    image = pdf[index].render(scale=SCALE).to_pil()
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


def read_page(key: str, model: str, jpeg: bytes) -> tuple:
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Transcribe this page."},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode(),
                            "detail": "high",
                        },
                    },
                ],
            },
        ],
        "max_completion_tokens": 4000,
    }
    request = urllib.request.Request(
        API,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                payload = json.load(response)
            usage = payload.get("usage", {})
            return payload["choices"][0]["message"]["content"] or "", usage
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < 3:
                time.sleep(4 * (attempt + 1))
                continue
            raise SystemExit(f"page failed ({e.code}): {e.read().decode()[:200]}")
    return "", {}


def parse_range(spec: str, total: int) -> list:
    if not spec:
        return list(range(total))
    out = []
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-")
            out += list(range(int(a) - 1, int(b)))
        else:
            out.append(int(part) - 1)
    return [n for n in out if 0 <= n < total]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--name", required=True, help="folder name, without the hash suffix")
    ap.add_argument("--pages", default="")
    ap.add_argument("--model", default="gpt-5.5")
    ap.add_argument("--estimate", action="store_true")
    args = ap.parse_args()

    import hashlib

    import pypdfium2 as pdfium

    source = ROOT / args.pdf if not Path(args.pdf).is_absolute() else Path(args.pdf)
    if not source.exists():
        raise SystemExit(f"not found: {source}")

    sha = hashlib.sha256(source.read_bytes()).hexdigest()
    folder = TEXT / f"{args.name}__{sha[:8]}"
    pdf = pdfium.PdfDocument(str(source))
    wanted = parse_range(args.pages, len(pdf))

    todo = [n for n in wanted if not (folder / f"page-{n + 1:03d}.md").exists()]

    if args.estimate:
        # Measured on this corpus: a rendered page is ~1.1k image tokens at high
        # detail, and a dense Arabic page comes back around 1.5k output tokens.
        print(f"{len(pdf)} pages, {len(todo)} still to read")
        print(f"  ~{len(todo) * 1.1:.0f}k input tokens, ~{len(todo) * 1.5:.0f}k output tokens")
        print("  Check your provider's current per-token price before running.")
        return

    folder.mkdir(parents=True, exist_ok=True)
    key = api_key()
    total_in = total_out = 0
    thin = []

    for n in todo:
        jpeg = render(pdf, n)
        text, usage = read_page(key, args.model, jpeg)
        total_in += usage.get("prompt_tokens", 0)
        total_out += usage.get("completion_tokens", 0)

        text = re.sub(r"^```[a-z]*\n|\n```$", "", text.strip())
        arabic = len(ARABIC.findall(text))
        if text and text != "[blank page]" and arabic < 40:
            thin.append(n + 1)

        (folder / f"page-{n + 1:03d}.md").write_text(text + "\n", encoding="utf-8")
        print(f"  page {n + 1:>3}  {len(text):>6} chars  {arabic:>5} arabic")

    print()
    print(f"{len(todo)} page(s) read into {folder.name}")
    print(f"  tokens: {total_in} in, {total_out} out")
    if thin:
        print(f"  CHECK these pages by eye — very little Arabic came back: {thin}")


if __name__ == "__main__":
    sys.exit(main())
