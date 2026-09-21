# -*- coding: utf-8 -*-
"""Which academic object uses each figure, and at what level is it owned?

    python scripts/corpus/figure_ownership.py              # → corpus/.mapping/figure-ownership.json
    python scripts/corpus/figure_ownership.py --show <pdf sha256 prefix>

C3 of three layers. C1 placed each exercise on the page; C2 said which
exercises geometry allows for each crop. This reads the words: the crop's own
caption ("Document 2", "Fig. 3", "المستند رقم (1)") and the references in the
canonical questions ("en se référant au document 2", "من خلال المستندين رقم (1)
ورقم (3)", "la figure ci-contre").

IDENTITY IS NOT OWNERSHIP. A caption says what a visual IS ("this is Document
2"). A reference says who USES it ("question 3 uses Document 2"). They are
recorded separately, and ownership is only claimed where the two meet.

THREE CONFIDENCES, NEVER MERGED. C1 `structuralConfidence` (where the exercise
is printed), C2 `geometricConfidence` (which exercises the crop could belong
to) and C3 `semanticConfidence` (who uses it) are separate fields. A UNIQUE
geometric candidate says only that one exercise is plausible — not which of
its questions use the figure; that stays EXERCISE-level until a reference says
more.

Deterministic. No model is asked anything. Nothing is written to the database
or to `contentImages`.
"""
import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from figure_candidates import crop_name  # noqa: E402
from position_structure import fold  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
META = ROOT / "corpus" / "meta"
C1_FILE = ROOT / "corpus" / ".mapping" / "positioned-structure.json"
C2_FILE = ROOT / "corpus" / ".mapping" / "figure-candidates.json"
EXAMS = ROOT / "corpus" / "exams.json"
OUT_FILE = ROOT / "corpus" / ".mapping" / "figure-ownership.json"

IN_SCOPE = {"UNIQUE_GEOMETRIC", "MULTIPLE_GEOMETRIC", "WEAK_GEOMETRIC"}
UNIQUE_RELATIONS = {"INSIDE", "CONTINUATION_PAGE", "LEAD_IN"}

# A caption line belongs to a crop when it starts within this many pixels of
# the crop's edge. Captions measured in the corpus sit 0-80px from their crop;
# the next paragraph is further.
CAPTION_GAP = 120

# --------------------------------------------------------------------------
# Numbers
#
# Mathpix reads Arabic-Indic digits in captions as look-alike Latin glyphs:
# "$(l)$" for ١, "$(\varepsilon)$" for ٤ — and "$(r)$" for both ٢ and ٣, "$(y)$"
# and "$(0)$" for others. Only the unambiguous readings are accepted; an
# ambiguous one is kept as `numberRaw` and never guessed.
# --------------------------------------------------------------------------
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_MISREAD = {"l": 1, "ε": 4, "varepsilon": 4}


def read_number(tok: str):
    """(number, raw). number is None when the token cannot be read with certainty."""
    t = tok.translate(_DIGITS).strip()
    if re.fullmatch(r"\d+", t):
        n = int(t)
        return (n if n > 0 else None), t
    if t in _MISREAD:
        return _MISREAD[t], t
    return None, t


def clean(text: str) -> str:
    """Folded text with LaTeX plumbing removed but its content kept."""
    t = fold(text).translate(_DIGITS)
    t = t.replace("\\varepsilon", "ε")
    # "Dans la figure ci -dessus" (gs/2011 1/math_fr.pdf): the text layer
    # splits the hyphenated deictics.
    t = re.sub(r"\bci\s*-\s*", "ci-", t)
    t = re.sub(r"https?://\S+", " ", t)
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", t)
    t = re.sub(r"\\(?:begin|end)\{[^}]*\}(\[[^\]]*\])?", " ", t)
    t = re.sub(r"\\(?:mathrm|mathbf|text|textbf|boldsymbol|operatorname)\{([^{}]*)\}", r"\1", t)
    t = re.sub(r"\\[a-zA-Z]+\*?", " ", t)
    t = re.sub(r"[{}$\\]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


# --------------------------------------------------------------------------
# Visual identity: what a caption says the visual is
#
# Forms taken from the corpus, not from a dictionary: in the figure blocks
# Mathpix wrote "Document #" 518 times, "Fig. #" 121, "Figure #" 45, "Doc. #"
# 45, "المستند رقم (#)" 29; "Document-#" and "\section*{Document #}" occur on
# the line below or above.
# --------------------------------------------------------------------------
_DOC_NOUN = r"(?:documents?|docs?\.?|المستندات|المستندين|المستند|المستثند|مستند|الوثيقه|الوثائق|وثيقه)"
_FIG_NOUN = r"(?:figures?|figs?\.?|الشكل|شكل)"
_NUM = r"[\(\[]?\s*([0-9]+|l|ε|[a-zA-Z])\s*([a-d])?\s*[\)\]]?"
_CAPTION = re.compile(rf"^\W*({_DOC_NOUN}|{_FIG_NOUN})\s*[-–:]?\s*(?:n°|no\.?|رقم)?\s*(?:{_NUM})?(?=\W|$)")


def kind_of(noun: str) -> str:
    return "figure" if re.fullmatch(_FIG_NOUN, noun) else "document"


def caption_identity(text: str):
    """The identity a caption line asserts, or None. Short lines only: a caption
    is a label, and "Document 2 shows the variation of…" is a sentence about it."""
    t = clean(text)
    if not t or len(t.split()) > 14:
        return None
    m = _CAPTION.match(t)
    if not m:
        return None
    kind = kind_of(m.group(1))
    raw_num, suffix = m.group(2), m.group(3)
    if raw_num is None:
        return {"kind": kind, "number": None, "numberRaw": None, "suffix": None, "text": t[:80]}
    n, raw = read_number(raw_num)
    # A range, "المستند رقم (l-r)": Documents 1 to 2 — or 1 to 3, since r is
    # both ٢ and ٣. Read only if both ends are certain; never as its first end.
    rng = re.match(r"\s*[-–]\s*([0-9]+|l|ε|[a-zA-Z])\b", t[m.end():]) if not suffix else None
    if rng:
        n2, raw2 = read_number(rng.group(1))
        if n is None or n2 is None or n2 <= n:
            return {"kind": kind, "number": None, "numberRaw": f"{raw}-{raw2}", "suffix": None, "text": t[:80]}
        return {"kind": kind, "number": n, "numbers": list(range(n, n2 + 1)), "numberRaw": f"{raw}-{raw2}",
                "suffix": None, "text": t[:80]}
    return {"kind": kind, "number": n, "numberRaw": raw, "suffix": suffix, "text": t[:80]}


def identities_for(sha: str, occs: list) -> dict:
    """occurrenceId → identity (or None), from the crop's own figure block, the
    line just below it, or — failing that, and only if no other crop claimed it —
    the line just above it."""
    data = json.loads((META / sha / "lines.json").read_text(encoding="utf-8"))
    by_page = defaultdict(list)
    for pg in data.get("pages", []):
        for li, ln in enumerate(pg.get("lines", [])):
            r = ln.get("region") or {}
            by_page[pg["page"]].append((r.get("top_left_y", 0), r.get("height", 0), str(ln.get("text") or ""), li))
    out, used = {}, set()
    page_occ = defaultdict(list)
    for o in occs:
        if o.get("page"):
            page_occ[o["page"]].append(o)

    def own_line(o):
        name = o["crop"].split("/")[-1].split(".")[0]
        for y, h, t, li in by_page[o["page"]]:
            for u in re.findall(r"https://cdn\.mathpix\.com/cropped/[^)\s\"'}]+", t):
                if name in crop_name(u):
                    return y, h, t, li
        return None

    below_pass = {}
    for page, lst in page_occ.items():
        lines = sorted(by_page[page])
        for o in lst:
            own = own_line(o)
            ident = None
            if own:
                caps = re.findall(r"\\caption\{([^{}]*)\}", own[2])
                for c in caps:
                    ident = caption_identity(c)
                    if ident:
                        ident["source"] = "figure-block caption"
                        break
                if not ident:
                    rest = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", own[2])
                    rest = re.sub(r"\\includegraphics(\[[^\]]*\])?\{[^}]*\}", " ", rest)
                    ident = caption_identity(rest)
                    if ident:
                        ident["source"] = "same line"
            y1 = o["bbox"]["y"] + o["bbox"]["h"]
            if not ident:
                nxt = [(y, t, li) for y, h, t, li in lines if y >= y1 - 10 and "cdn.mathpix" not in t]
                if nxt:
                    y, t, li = min(nxt)
                    if y - y1 <= CAPTION_GAP:
                        cand = caption_identity(t)
                        if cand:
                            cand["source"] = "line below"
                            below_pass[o["occurrenceId"]] = (cand, li)
                            used.add(li)
                            out[o["occurrenceId"]] = cand
                            continue
            out[o["occurrenceId"]] = ident
        for o in lst:
            if out.get(o["occurrenceId"]):
                continue
            y0 = o["bbox"]["y"]
            prv = [(y + h, t, li) for y, h, t, li in lines if y + h <= y0 + 10 and "cdn.mathpix" not in t]
            if prv:
                y, t, li = max(prv)
                if y0 - y <= CAPTION_GAP and li not in used:
                    cand = caption_identity(t)
                    if cand:
                        cand["source"] = "line above"
                        out[o["occurrenceId"]] = cand
    return out


# --------------------------------------------------------------------------
# Question structure and references
# --------------------------------------------------------------------------
def top_of(label: str) -> str:
    """The top-level question a part label belongs to: "2.1" → "2", "A.3.1" → "A.3"."""
    comps = [c for c in re.split(r"[.\-)]", str(label or "")) if c]
    if not comps:
        return str(label)
    if re.fullmatch(r"[A-Za-z]+", comps[0]) and len(comps) > 1:
        return ".".join(comps[:2])
    return comps[0]


def nodes_of(ex: dict) -> list:
    """Intro (title + statement) and every part, with its level."""
    out = [{"node": "intro", "label": None, "top": None, "level": "INTRO",
            "text": " ".join(filter(None, [ex.get("title"), ex.get("statement")]))}]
    for i, p in enumerate(ex.get("parts") or []):
        lab = str(p.get("label") or f"#{i + 1}")
        top = top_of(lab)
        sub = lab != top
        out.append({"node": f"part{i + 1}", "label": lab, "top": top,
                    "level": "SUBQUESTION" if sub else "QUESTION", "text": p.get("text") or ""})
    return out


_SEP = r"(?:\s*(?:,|;|&|et|and|or|ou|و|ورقم|او|-|–|à|a|to|الى|حتي|حتى)\s*(?:rq|رقم)?\s*)"
_REF = re.compile(
    rf"({_DOC_NOUN}|{_FIG_NOUN})\s*[-–:]?\s*(?:n°|no\.?|رقم)?\s*[\(\[]?\s*([0-9]+)\s*([a-d](?![a-z]))?\s*[\)\]]?"
    rf"((?:{_SEP}[\(\[]?\s*[0-9]+\s*[\)\]]?)*)")
# Unnumbered visual references: a visual noun used deictically, or a noun that
# only makes sense with a drawing in front of the student.
_DEICTIC = re.compile(
    r"((?:figure|fig\.?|document|doc\.?|sch[eé]ma|schema|diagram\w*|graph\w*|courbe|curve|circuit|montage|dispositif|"
    r"الشكل|الرسم|المستند)\s*(?:\([a-z]\)\s*)?(?:ci-contre|ci-dessous|ci-dessus|adjacent|opposite|below|above|"
    r"suivant\w*|following|shown|المقابل|التالي|ادناه|اعلاه))|"
    r"((?:adjacent|opposite|following|above|below)\s+(?:figure|diagram|circuit|graph|document|curve))|"
    r"(\b(?:circuit|montage)\b)|(\b(?:courbe|curve)\s*\((?:c|γ|c')\))")


def references(text: str) -> list:
    """Every numbered visual reference in a text, lists and ranges expanded."""
    t = clean(text)
    out = []
    for m in _REF.finditer(t):
        kind = kind_of(m.group(1))
        first = int(m.group(2))
        nums = [first]
        tail = m.group(4) or ""
        prev = first
        for sep, n in re.findall(rf"({_SEP})[\(\[]?\s*([0-9]+)", tail):
            n = int(n)
            if re.search(r"(à|\ba\b|to|الى|حتي|حتى|-|–)", sep) and prev < n <= prev + 6:
                nums.extend(range(prev + 1, n + 1))
            else:
                nums.append(n)
            prev = n
        for n in nums:
            if 0 < n < 30:
                out.append({"kind": kind, "number": n, "suffix": m.group(3) if n == first else None,
                            "text": m.group(0)[:60]})
    return out


def generic_refs(text: str) -> list:
    return sorted({m.group(0)[:40] for m in _DEICTIC.finditer(clean(text))})


def is_caption_echo(line: str, start: int) -> bool:
    """The canonical text is the PDF's own text layer, so it contains the printed
    captions: "Document 1" on a line of its own, or run into a table
    ("Document 1 3 Docu…"). A mention that opens a short line is the caption
    printed again, not a question pointing at it."""
    return start <= 2 and len(line.split()) <= 10 and "?" not in line


def split_question(text: str) -> tuple:
    """(own question text, trailing stimulus) of one part.

    The extractor appends whatever follows a question to it, so part 3 reads
    "3. Que peut-on en conclure … ? Expérience 2 : On porte séparément …" —
    the setup for question 4 riding on question 3. The question is its first
    "?" if one comes early, else its first sentence; the rest is stimulus."""
    q = text.find("?")
    if 0 <= q <= 400:
        return text[:q + 1], text[q + 1:]
    # Skip the part's own label first: "2.1. En se référant au document-1, …"
    # was cut after "2.1." and its whole question filed as stimulus.
    lab = re.match(r"\s*(?:[A-Za-z]{1,4}\s*[-.)]\s*)?(?:\d+\s*[-.)]\s*)*(?:[a-z]\s*[-.)]\s*)?", text)
    start = lab.end() if lab else 0
    m = re.search(r"[.:!](?:\s|$)", text[start:])
    if m:
        cut = m.end() + start
        return text[:cut], text[cut:]
    return text, ""


def exercise_refs(ex: dict) -> list:
    """Numbered references with where they sit: `role` is question (a part's own
    question text), stimulus (intro, or text trailing a question) — caption
    echoes are dropped."""
    out = []
    for nd in nodes_of(ex):
        if nd["level"] == "INTRO":
            pieces = [("stimulus", nd["text"])]
        else:
            own, rest = split_question(nd["text"])
            pieces = [("question", own), ("stimulus", rest)]
        for role, text in pieces:
            for line in text.split("\n"):
                cl = clean(line)
                for r in references(line):
                    pos = cl.find(r["text"])
                    if is_caption_echo(cl, pos if pos >= 0 else 99):
                        continue
                    out.append({**r, "node": nd["node"], "label": nd["label"], "top": nd["top"],
                                "level": nd["level"], "role": role})
    return out


def level_from(refs: list) -> tuple:
    """Ownership level from who CONSUMES a visual — the questions whose own text
    names it — not from where it is introduced.

    Lebanese papers introduce a document in the stimulus ("Le document 2
    montre…") and then one or more questions name it ("Analyser le document
    2"). Of the directly referenced crops, 473 are named only in stimulus, 283
    in stimulus and one question, 47 in stimulus and several. Introduction is
    recorded by the caller; the level says who uses it:
        two or more questions      EXERCISE_SHARED
        one question               QUESTION / SUBQUESTION
        stimulus only              EXERCISE_CONTEXT
    """
    q = [r for r in refs if r["role"] == "question"]
    tops = sorted({r["top"] for r in q})
    if len(tops) >= 2:
        return "EXERCISE_SHARED", tops
    if len(tops) == 1:
        subs = {r["label"] for r in q if r["level"] == "SUBQUESTION"}
        if len(subs) == 1 and all(r["level"] == "SUBQUESTION" for r in q):
            return "SUBQUESTION", sorted(subs)
        return "QUESTION", tops
    return "EXERCISE_CONTEXT", []


def matches(identity: dict, ref: dict) -> bool:
    nums = identity.get("numbers") or [identity["number"]]
    if identity["kind"] != ref["kind"] or ref["number"] not in nums:
        return False
    return not (identity.get("suffix") and ref.get("suffix") and identity["suffix"] != ref["suffix"])


# --------------------------------------------------------------------------
# Ownership
# --------------------------------------------------------------------------
# Pointing language, taken from the corpus: "figure ci-contre" 36, "tableau
# ci-dessous" 52, "table below" 108, "trois courbes données ci-après".
_VISUAL = (r"(?:figures?|figs?\.?|documents?|docs?\.?|sch[eé]mas?|graph\w*|courbes?|curves?|circuits?|"
           r"diagram\w*|montage|dispositif|enregistrements?|recordings?|tableaux?|tables?|"
           r"الشكل|الرسم|المستند\w*|الوثيق\w*|الجدول)")
FORWARD = r"(?:ci-apr[eè]s|ci-dessous|suivant\w*|below|following|ادناه|التالي\w*)"
BACKWARD = r"(?:ci-dessus|above|اعلاه)"
BESIDE = r"(?:ci-contre|adjacent|opposite|المقابل\w*)"


def pointing(text: str, direction: str):
    """The first 'visual noun … pointing word' (or the reverse, English order)
    in a text, or None."""
    t = clean(text)
    m = re.search(rf"{_VISUAL}[^.?!]{{0,30}}?{direction}|{direction}\s+(?:\w+\s+){{0,2}}{_VISUAL}", t)
    return m.group(0)[:50] if m else None


def resolve(o: dict, ident, exs: dict, family: str, same_ident_in: dict) -> dict:
    """Semantic owner, level and confidence for one in-scope occurrence."""
    cands = o["candidates"]
    placed = [c for c in cands if c["relation"] != "UNPLACED_BETWEEN"]
    unique_geo = o["geometricConfidence"] == "UNIQUE_GEOMETRIC"
    geo_ord = cands[0]["ordinal"] if unique_geo else None
    # Arabic Geography numbers its documents across the whole paper and prints
    # them as one block; the scope is every container, not the geometric ones.
    scope = sorted(exs) if family == "geography-ar" else sorted({c["ordinal"] for c in cands})
    ev = []
    res = {"semanticOwner": None, "ownershipLevel": "UNRESOLVED", "semanticConfidence": "UNRESOLVED",
           "references": [], "evidence": ev}

    if ident and ident["number"] is not None:
        hits = {}
        for ordn in scope:
            rs = [r for r in exs[ordn]["refs"] if matches(ident, r)]
            if rs:
                hits[ordn] = rs
        res["references"] = [{"containerOrdinal": k, **{x: r[x] for x in ("label", "level", "role", "text")}}
                             for k in sorted(hits) for r in hits[k]]
        label = f"{ident['kind']} {ident['number']}{ident.get('suffix') or ''}"
        if family == "geography-ar" and hits:
            owners = sorted(hits)
            if len(owners) >= 2:
                res.update(semanticOwner={"containerOrdinals": owners}, ownershipLevel="PAPER_SHARED",
                           semanticConfidence="DIRECT_REFERENCE")
                ev.append(f"captioned {label}; referenced by containers {owners} — a shared document")
            else:
                lvl, nodes = level_from(hits[owners[0]])
                res.update(semanticOwner={"containerOrdinals": owners, "consumedBy": nodes, "introducedInStimulus": any(r["role"] == "stimulus" for r in hits[owners[0]])}, ownershipLevel=lvl,
                           semanticConfidence="DIRECT_REFERENCE")
                ev.append(f"captioned {label}; referenced only by container {owners[0]}")
            if same_ident_in.get(label, 1) > 1:
                ev.append(f"{same_ident_in[label]} crops carry the caption {label} in this paper — "
                          f"one visual in several crops, or a numbering collision")
            return res
        if len(hits) == 1:
            ordn = next(iter(hits))
            lvl, nodes = level_from(hits[ordn])
            conf = "DIRECT_REFERENCE"
            res.update(semanticOwner={"containerOrdinals": [ordn], "consumedBy": nodes, "introducedInStimulus": any(r["role"] == "stimulus" for r in hits[ordn])}, ownershipLevel=lvl,
                       semanticConfidence=conf)
            ev.append(f"captioned {label}; among the geometric candidates only container {ordn} names it")
            return res
        if len(hits) > 1:
            if geo_ord in hits:
                lvl, nodes = level_from(hits[geo_ord])
                res.update(semanticOwner={"containerOrdinals": [geo_ord], "consumedBy": nodes, "introducedInStimulus": any(r["role"] == "stimulus" for r in hits[geo_ord])}, ownershipLevel=lvl,
                           semanticConfidence="CORROBORATED")
                ev.append(f"captioned {label}; several candidates name a {label}, geometry picks container {geo_ord}")
            else:
                res.update(semanticConfidence="AMBIGUOUS")
                ev.append(f"captioned {label}; containers {sorted(hits)} all name a {label} and geometry "
                          f"does not choose")
            return res
        # Captioned, but no candidate names it.
        if unique_geo:
            res.update(semanticOwner={"containerOrdinals": [geo_ord]}, ownershipLevel="EXERCISE",
                       semanticConfidence="CONTEXTUAL")
            ev.append(f"captioned {label} but container {geo_ord} never names it — owned by geometry alone")
        else:
            ev.append(f"captioned {label}; no candidate names it")
        return res

    if ident and ident["number"] is None and ident.get("numberRaw"):
        ev.append(f"caption '{ident['text']}' carries an unreadable numeral '{ident['numberRaw']}' — not guessed")

    # No usable number: geometry plus unnumbered references.
    if unique_geo:
        g = exs[geo_ord]["generic"]
        numbered_elsewhere = sorted({f"{r['kind']} {r['number']}" for r in exs[geo_ord]["refs"]})
        if g:
            res.update(semanticOwner={"containerOrdinals": [geo_ord]}, ownershipLevel="EXERCISE",
                       semanticConfidence="CORROBORATED")
            ev.append(f"only geometric candidate is container {geo_ord}, and its text refers to a visual "
                      f"without a number ({', '.join(g[:3])})")
        else:
            res.update(semanticOwner={"containerOrdinals": [geo_ord]}, ownershipLevel="EXERCISE",
                       semanticConfidence="CONTEXTUAL")
            ev.append(f"only geometric candidate is container {geo_ord}; no caption"
                      + (f"; the exercise names {', '.join(numbered_elsewhere[:4])} but the crop carries no number"
                         if numbered_elsewhere else "; the exercise text names no visual"))
        return res
    # A figure BETWEEN two exercises. A visual noun anywhere in a neighbour's
    # text proves nothing (ls/2015 1/chem_fr.pdf: exercise 2 mentions "courbe
    # (C)", but the three curves opening page 2 are exercise 1's — its last
    # question says "trois courbes données ci-après"). Only pointing language
    # next to the figure counts: forward ("ci-après", "below") at the end of
    # the exercise above, backward ("ci-dessus", "above") at the start of the
    # exercise below, "ci-contre" / "adjacent" on either side.
    rel = {c["ordinal"]: c["relation"] for c in placed}
    claims = {}
    for k, r in rel.items():
        if r in ("BELOW_NEAR", "SAME_PAGE_DISTANT", "DISTANT") and k == min(rel):
            hit = pointing(exs[k]["tail"], FORWARD) or pointing(exs[k]["tail"], BESIDE)
        elif r in ("ABOVE_NEAR", "SAME_PAGE_DISTANT", "DISTANT", "CONTINUATION_PAGE"):
            hit = pointing(exs[k]["head"], BACKWARD) or pointing(exs[k]["head"], BESIDE)
        else:
            hit = None
        if hit:
            claims[k] = hit
    if len(placed) >= 2 and len(claims) == 1:
        k = next(iter(claims))
        res.update(semanticOwner={"containerOrdinals": [k]}, ownershipLevel="EXERCISE",
                   semanticConfidence="CONTEXTUAL")
        ev.append(f"geometry allows {sorted(rel)}; only container {k} points at a figure next to it "
                  f"('{claims[k]}')")
        return res
    if len(claims) >= 2:
        ev.append(f"both neighbours point at a figure: {claims}")
    if len(placed) >= 2:
        res.update(semanticConfidence="AMBIGUOUS")
        ev.append(f"geometry allows {[c['ordinal'] for c in placed]} and no caption or reference separates them")
        return res
    ev.append("one weak geometric candidate and no caption or reference to confirm it")
    return res


def exercise_facts(ex: dict) -> dict:
    """What C3 reads from one canonical exercise: numbered references with their
    role, unnumbered visual words, and its first and last stretches of text."""
    nds = nodes_of(ex)
    return {"refs": exercise_refs(ex),
            "generic": generic_refs(" ".join(nd["text"] for nd in nds)),
            "head": " ".join(nd["text"] for nd in nds[:2]),
            "tail": nds[-1]["text"]}


def build() -> dict:
    c2 = json.loads(C2_FILE.read_text(encoding="utf-8"))
    exams = {}
    for e in json.loads(EXAMS.read_text(encoding="utf-8")):
        if e.get("sha256"):
            exams.setdefault(e["sha256"], e)
    by_sha = defaultdict(list)
    for o in c2["occurrences"]:
        by_sha[o["pdfSha256"]].append(o)

    out = []
    for sha in sorted(by_sha):
        occs = by_sha[sha]
        positioned = [o for o in occs if o.get("page")]
        idents = identities_for(sha, positioned) if positioned and (META / sha / "lines.json").exists() else {}
        ex_row = exams.get(sha)
        exs = {}
        if ex_row:
            for i, ex in enumerate(ex_row.get("exercises") or []):
                exs[i + 1] = exercise_facts(ex)
        labels = Counter(f"{v['kind']} {v['number']}{v.get('suffix') or ''}" for v in idents.values()
                         if v and v.get("number") is not None)
        for o in occs:
            ident = idents.get(o["occurrenceId"])
            rec = {
                "occurrenceId": o["occurrenceId"], "pdfSha256": sha, "crop": o["crop"], "page": o.get("page"),
                "papers": o.get("papers") or [], "family": o.get("family"),
                "c2": {"eligibility": o["eligibility"], "geometricConfidence": o.get("geometricConfidence"),
                       "territory": o.get("territory"),
                       "candidates": [{"ordinal": c["ordinal"], "relation": c["relation"],
                                       "structuralConfidence": c["structuralConfidence"]}
                                      for c in o.get("candidates") or []]},
                "visualIdentity": ident,
            }
            if o["eligibility"] == "ELIGIBLE" and o.get("geometricConfidence") in IN_SCOPE and exs:
                rec["scope"] = "C3"
                rec.update(resolve(o, ident, exs, o.get("family"), labels))
            else:
                rec["scope"] = ("non-academic" if o["eligibility"] == "NON_ACADEMIC_CANDIDATE" else
                                "no-position-source" if o["eligibility"] == "NO_POSITION_SOURCE" else
                                "position-uncertain" if o["eligibility"] == "POSITION_UNCERTAIN" else
                                "c2-none")
                terr = str(o.get("territory") or "")
                level = ("SOLUTION_MATERIAL" if terr in ("trailing:scheme-marker", "trailing:paper-header")
                         else "EXCLUDED" if rec["scope"] == "non-academic" else "UNRESOLVED")
                rec.update({"semanticOwner": None, "ownershipLevel": level, "semanticConfidence": None,
                            "references": [], "evidence": []})
                # A crop geometry put out of statement territory whose caption a
                # statement names, with no in-statement crop carrying it: flag
                # for review, never promote.
                if rec["scope"] == "c2-none" and ident and ident.get("number") is not None and exs:
                    label = f"{ident['kind']} {ident['number']}"
                    named = sorted(k for k, v in exs.items() if any(matches(ident, r) for r in v["refs"]))
                    if named:
                        rec["c2Contradiction"] = {"caption": label, "namedByContainers": named}
                        rec["evidence"].append(f"outside statement territory, yet captioned {label}, which "
                                               f"containers {named} name — review, not promoted")
            for c in (rec.get("semanticOwner") or {}).get("containerOrdinals", []):
                rec.setdefault("ownerContainerIds", []).append(f"{sha[:12]}#{c}")
            out.append(rec)

    # ONE IDENTITY, SEVERAL CROPS. Adjacent crops on one page that share a
    # caption are the panels of one visual (45 such groups). The same caption
    # on crops pages apart inside one owner is a conflict: ls/2017 1/bio_fr.pdf
    # has "Document 1" on pages 2, 3 and 4 all under container 2, because that
    # container spans three printed exercises. None of them may stay owned.
    order = {o["occurrenceId"]: o.get("order") for o in c2["occurrences"]}
    groups = defaultdict(list)
    for r in out:
        v, so = r.get("visualIdentity"), r.get("semanticOwner") or {}
        if r["scope"] == "C3" and v and v.get("number") is not None and len(so.get("containerOrdinals") or []) == 1:
            groups[(r["pdfSha256"], so["containerOrdinals"][0], v["kind"], v["number"], v.get("suffix"))].append(r)
    for key, rs in sorted(groups.items()):
        if len(rs) < 2:
            continue
        orders = sorted(order[r["occurrenceId"]] for r in rs)
        if len({r["page"] for r in rs}) == 1 and orders == list(range(orders[0], orders[0] + len(orders))):
            for r in rs:
                r["multiPartVisual"] = len(rs)
            continue
        for r in rs:
            r["evidence"].append(f"identity conflict: {len(rs)} crops on pages {sorted({x['page'] for x in rs})} "
                                 f"all claim {key[2]} {key[3]} of container {key[1]} — was "
                                 f"{r['semanticConfidence']}, not kept")
            r.update(semanticConfidence="AMBIGUOUS", ownershipLevel="UNRESOLVED",
                     candidateOwner=r.get("semanticOwner"), semanticOwner=None)
            r.pop("ownerContainerIds", None)
    out.sort(key=lambda r: (r["pdfSha256"], r["occurrenceId"]))
    return {"inputs": {"figureCandidatesSha256": hashlib.sha256(C2_FILE.read_bytes()).hexdigest(),
                       "positionedStructureSha256": hashlib.sha256(C1_FILE.read_bytes()).hexdigest(),
                       "rules": {"CAPTION_GAP": CAPTION_GAP}},
            "occurrences": out}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT_FILE))
    ap.add_argument("--show", default=None)
    args = ap.parse_args()
    result = build()
    if args.show:
        for r in result["occurrences"]:
            if r["pdfSha256"].startswith(args.show):
                print(json.dumps(r, ensure_ascii=False, indent=1))
        return
    text = json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    Path(args.out).write_text(text, encoding="utf-8")
    occ = result["occurrences"]
    sc = Counter(r["scope"] for r in occ)
    inn = [r for r in occ if r["scope"] == "C3"]
    print(f"occurrences {len(occ)}  in C3 scope {len(inn)}  others {dict(sorted(sc.items()))}")
    print("semantic confidence:", dict(Counter(r["semanticConfidence"] for r in inn).most_common()))
    print("ownership level    :", dict(Counter(r["ownershipLevel"] for r in inn).most_common()))
    print(f"sha256 : {hashlib.sha256(text.encode('utf-8')).hexdigest()}")


if __name__ == "__main__":
    main()
