# -*- coding: utf-8 -*-
"""Fixtures for paper_parts — scheme rows bound to printed parts by label.

    python scripts/corpus/test_paper_parts.py

Each case is a shape the GS science schemes actually print, and where it came
from a real paper the paper is named. The table cases go through
`scheme_rows`, the same path the corpus run uses, with only the page text
handed in.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8")

import paper_parts as pp  # noqa: E402

FAILURES = []


def check(name, ok, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f" — {detail}"))
    if not ok:
        FAILURES.append(name)


def rows_of(text, track="gs"):
    """scheme_rows over one page of Mathpix text."""
    real = pp.scheme_text
    pp.scheme_text = lambda exam, sha: [(5, text)]
    try:
        rows, why = pp.scheme_rows({}, "x", track)
    finally:
        pp.scheme_text = real
    return rows


print("marks")
for cell, want in [
    ("0.25", 0.25), ("0,75", 0.75), ("1 ½", 1.5), ("$7 \\frac{1}{2}$", 7.5),
    # gs/2011 2/phy_en.pdf: one row's marks stacked one per line
    ("$\\frac{\\mathbf{1}}{\\mathbf{4}} \\frac{\\mathbf{1}}{\\mathbf{4}}$", 0.5),
    ("$\\frac{1}{4} \\frac{1}{2}$", 0.75),
    ("Mark", None), ("", None), ("3/5", None),
    ("\\mathrm{u}_{\\mathrm{C}}=\\mathrm{A}+\\mathrm{B}", None),
]:
    got = pp.parse_mark(cell)
    check(f"mark {cell[:30]!r} -> {want}", got == want, f"got {got}")

print("labels")
for cells, want in [
    (["1", "1-1"], ("1", "1")),          # the label column repeats its parent
    (["2", "2-1", "2-11"], ("2", "1", "1")),  # gs/2017 2/phy_en.pdf: hyphens lost
    (["2", "2"], ("2", "2")),            # gs/2019/phy_en.pdf: a child, not a repeat
    (["A", "1"], ("A", "1")),
]:
    got = pp.join_label_cells(cells)
    check(f"join {cells} -> {want}", got == want, f"got {got}")
check("Cyrillic look-alikes", pp.label_tokens("В.З.a") == ("B", "3", "A"), str(pp.label_tokens("В.З.a")))

print("headings")
for text, want in [
    ("Exercise 2 (8 points) Electric power in an RLC circuit", 2),
    ("First exercise (7.5 points)", 1),
    ("Deuxième exercice (6 points) (S.V)", 2),
    ("as in exercise 1, the period is", None),
]:
    got = pp.exercise_heading(text)
    check(f"heading {text[:36]!r} -> {want}", got == want, f"got {got}")
check("(S.V) is another track's", pp.other_track("Deuxième exercice (6 points) (S.V)", "gs"))
check("(S.G) is ours", not pp.other_track("Deuxième exercice (6 points) (S.G)", "gs"))
check("untagged is ours", not pp.other_track("Exercise 2 (6 points)", "gs"))

print("tables")
# gs/2019/phy_en.pdf exercise 2: \multirow carries "2" down over 2-1..2-3,
# then "3" stands alone in the second label column.
rows = rows_of(
    "\\caption{Exercice 2 (8 points) Electric power}\n"
    "\\begin{tabular}[t]{|l|l|l|l|}\n"
    "\\hline & Part & Answer & Marks \\\\\n"
    "\\hline & 1 & drawing & 0.25 \\\\\n"
    "\\hline \\multirow{3}{*}{2} & 1 & waveform (a) & 0.5 \\\\\n"
    "\\hline & 2 & $I_m=0.07$ A & 0.5 \\\\\n"
    "\\hline & 3 & $\\varphi=\\pi/4$ & 0.5 \\\\\n"
    "\\hline & 3 & $i=0.07\\sin(1250t-\\pi/4)$ & 0.5 \\\\\n"
    "\\hline\n\\end{tabular}")
got = [(r["exercise"], ".".join(r["tokens"]), r["marks"]) for r in rows]
want = [(2, "1", 0.25), (2, "2.1", 0.5), (2, "2.2", 0.5), (2, "2.3", 0.5), (2, "3", 0.5)]
check("multirow label carried, then dropped", got == want, str(got))

# gs/2015 2/chem_fr.pdf: the scheme prints exercise 2 for GS and again for LS.
rows = rows_of(
    "\\caption{Deuxième exercice (6 points) (S.G)}\n"
    "\\begin{tabular}[t]{|l|l|l|}\n\\hline Partie de la Q. & Corrigé & Note \\\\\n"
    "\\hline 1.1 & ours & 1 \\\\\n\\hline\n\\end{tabular}\n"
    "\\caption{Deuxième exercice (6 points) (S.V)}\n"
    "\\begin{tabular}[t]{|l|l|l|}\n\\hline Partie de la Q. & Corrigé & Note \\\\\n"
    "\\hline 1.1 & theirs & 1 \\\\\n\\hline\n\\end{tabular}")
check("the other track's version is skipped", [r["answer"] for r in rows] == ["ours"], str([r["answer"] for r in rows]))

# gs/2017 2/phy_en.pdf: the heading is a row, and carries the exercise total.
rows = rows_of(
    "\\begin{tabular}[t]{|l|l|l|l|l|}\n"
    "\\hline \\multicolumn{4}{|l|}{Exercise 1 : torsion pendulum} & $7 \\frac{1}{2}$ \\\\\n"
    "\\hline \\multirow{2}{*}{1} & \\multicolumn{2}{|c|}{1-1} & $ME=\\frac12 I\\theta'^2$ & 1 \\\\\n"
    "\\hline & \\multicolumn{2}{|c|}{1-2} & ME const & 1 \\\\\n\\hline\n\\end{tabular}")
got = [(r["exercise"], ".".join(r["tokens"]), r["marks"]) for r in rows]
check("heading row with marks is a heading", got == [(1, "1.1", 1.0), (1, "1.2", 1.0)], str(got))

# gs/2021 2/SG_Math_2021_2_En.pdf: the header names the exercise and carries its
# total where "Mark" would be; the fifth exercise is misprinted "III".
rows = rows_of(
    "\\begin{tabular}[t]{|l|l|l|}\n\\hline IV & Answers & 6pts \\\\\n"
    "\\hline 1.a & $x=1$ & 1 \\\\\n\\hline\n\\end{tabular}\n"
    "\\begin{tabular}[t]{|l|l|l|}\n\\hline III & Answers & 12pts \\\\\n"
    "\\hline 1 & $f(0)=2$ & 1 \\\\\n\\hline\n\\end{tabular}")
got = [(r["exercise"], ".".join(r["tokens"])) for r in rows]
check("a header known by its shape; a backwards number is the next exercise",
      got == [(4, "1.A"), (5, "1")], str(got))
# gs/2005 1/gs math_en 1.pdf repeats a header when its table runs on: same exercise.
rows = rows_of(
    "\\begin{tabular}[t]{|l|l|l|}\n\\hline Q2 & Short Answers & M \\\\\n"
    "\\hline 1 & a & 1 \\\\\n\\hline\n\\end{tabular}\n"
    "\\begin{tabular}[t]{|l|l|l|}\n\\hline Q2 & Short Answers & M \\\\\n"
    "\\hline 2 & b & 1 \\\\\n\\hline\n\\end{tabular}")
got = [(r["exercise"], ".".join(r["tokens"])) for r in rows]
check("a repeated header continues its exercise", got == [(2, "1"), (2, "2")], str(got))

# gs/2007 1/math_en.pdf I: one mark printed across all the questions' rows.
rows = rows_of(
    "\\begin{tabular}[t]{|l|l|l|}\n\\hline Q1 & Answers & M \\\\\n"
    "\\hline 1 & a & \\multirow{3}{*}{4} \\\\\n\\hline 2 & b & \\\\\n\\hline 3 & c & \\\\\n"
    "\\hline\n\\end{tabular}")
got = [(r["label"], r["marks"], r["sharedMark"]) for r in rows]
check("a spanned mark is counted once, its rows flagged",
      got == [("1", 4.0, True), ("2", None, True), ("3", None, True)], str(got))

print("binding")
parts = [{"label": "A.1"}, {"label": "A.2"}, {"label": "B.1"}, {"label": "B.2"}]
mk = lambda lab: {"tokens": pp.label_tokens(lab), "label": lab, "answer": lab, "marks": 1}
bound, orphans = pp.bind_rows([mk("A.1"), mk("A.2.a"), mk("B.1"), mk("2")], parts)
check("deeper row binds to its part; bare '2' completes to B.2",
      [i for i, _ in bound] == [0, 1, 2, 3] and not orphans, str([i for i, _ in bound]))
bound, orphans = pp.bind_rows([mk("A.1"), mk("C.1")], parts)
check("a label no part has is an orphan", len(orphans) == 1)

print("scale")
ok = lambda s: {"status": "bound", "sum": s}
check("two exercises at 2x set the scale",
      pp.paper_scale([(ok(4.0), {"marks": 2.0}), (ok(6.0), {"marks": 3.0}), (ok(3.0), {"marks": 3.0})]) == 2.0)
check("one exercise at 2x does not",
      pp.paper_scale([(ok(4.0), {"marks": 2.0}), (ok(3.0), {"marks": 3.0})]) == 1.0)

print("statement")
md = ("**Exercise 1 (7 points)**\nThe aim of this exercise is to study a pendulum.\n\n"
      "**A- Theoretical study**\nWe neglect friction.\n"
      "1) Write the expression of the mechanical energy of the system.\n"
      "2) Deduce the differential equation of the motion.\n\n"
      "**B- Experimental study**\n"
      "1) Determine the period from the graph of document 2.")
parts = [
    {"label": "A.1", "text": "1) Write the expression of the mechanical energy of the system."},
    {"label": "A.2", "text": "2) Deduce the differential equation of the motion."},
    {"label": "B.1", "text": "1) Determine the period from the graph of document 2."},
]
split, why = pp.split_statement(md, parts)
check("split found every part", split is not None, why)
if split:
    intro, segs = split
    check("section A's heading opens part A.1", segs[0].startswith("**A- Theoretical"), segs[0][:30])
    check("section B's heading opens part B.1, not the tail of A.2",
          segs[2].startswith("**B- Experimental") and "B- " not in segs[1], segs[1][-40:])
    check("the intro keeps the exercise's own lines", intro.endswith("study a pendulum."), intro[-30:])

# gs/2019/phy_en.pdf exercise 2: part 5's words also read, with a gap, from
# "the capacitor is: Determine the expression" inside part 4.
md = ("4) Show that the voltage across the capacitor is:\n$$u_{DK}=-22.4\\cos(1250t)$$\n\n"
      "5) Determine the expression of the voltage $u_{KN}$ across the terminals of the coil.\n\n"
      "7-1) Determine the value of $f_1$.\n\n7-2) Calculate the value of $P_1$.")
parts = [
    {"label": "4", "text": "4) Show that the voltage across the capacitor is: uDK = uC = – 22.4 cos"},
    {"label": "5", "text": "5) Determine the expression of the voltage uKN = ucoil across the terminals t (S) 0 0.183"},
    {"label": "7.1", "text": "7-1) Determine the value of f1."},
    {"label": "7.2", "text": "7-2) Calculate the value of P1."},
]
split, why = pp.split_statement(md, parts)
check("2019 split found every part", split is not None, why)
if split:
    _, segs = split
    check("part 4 keeps its own formula", segs[0].startswith("4) Show") and "22.4" in segs[0], segs[0][:60])
    check("part 5 starts at its own label", segs[1].startswith("5) Determine"), segs[1][:40])
    check("7-2 is not cut inside 7-1", segs[2] == "7-1) Determine the value of $f_1$.", segs[2])

print("belonging")
# gs/2013 1/math_en.pdf: exercises IV and V are both worth 3 points with parts
# 1-4, so V's probability answers bound to IV passed the marks gate.
exam = {"sha256": "x", "exercises": [
    {"index": 4, "title": "IV", "statement": "Consider a circle (C) with center O and diameter [AB]. "
     "Let S be the direct similitude with center B, ratio k and angle alpha, S(I) = J.", "parts": []},
    {"index": 5, "title": "V", "statement": "An urn contains five red balls and five green balls. "
     "Three balls are selected simultaneously and randomly from the urn.", "parts": []},
]}
probability = {"status": "ok", "byPart": {0: {"answer": "P(E) = C_5^3 / C_10^3, three green balls; "
               "P(T/E) = 1 green ball drawn from the urn, red balls remain"}}}
geometry = {"status": "ok", "byPart": {0: {"answer": "S = sim(B; k; alpha): I -> J, the circle (C) with "
            "diameter [AB] has image the circle with diameter S[AB], similitude ratio"}}}
wrong = {"answers": dict(probability)}
pp.check_belonging(exam, [(wrong, exam["exercises"][0])])
check("another exercise's answers are refused", wrong["answers"]["status"] == "answers read like another exercise",
      str(wrong["answers"]))
right = {"answers": dict(geometry)}
pp.check_belonging(exam, [(right, exam["exercises"][0])])
check("an exercise's own answers are kept", right["answers"]["status"] == "ok", str(right["answers"]))

print("answers that are misplaced")
by = lambda *answers: {i: {"answer": a} for i, a in enumerate(answers)}  # noqa: E731
shifted = [{"label": "1", "text": "1) Prove that P = 2/15."},
           {"label": "2", "text": "2) Determine the probability distribution of X."},
           {"label": "3", "text": "3) Show that the probability is 4/9."}]
check("sub-answers a), b) under a question that asks none (gs/2013 2/math_en.pdf V)",
      bool(pp.misplaced_trace(shifted, by("P(4)=1/3", "**a)** X(Ω)={0;1;2} **b)** P=4/9", "P=13/36"))))
check("a), b) under a question that asks a, b pass",
      not pp.misplaced_trace([{"label": "2", "text": "2) a- Find f(B). b - Specify the ratio."}],
                             by("**a)** f(B)=F **b)** ratio 2/3")))
check("a), b) under letters written as maths pass",
      not pp.misplaced_trace([{"label": "2", "text": "2) $\\boldsymbol{a}$ - Find σ. $\\boldsymbol{b}$ - Deduce."}],
                             by("**a)** σ=Mt **b)** …")))
leaky = [{"label": "I.2", "text": "2 - Name the ester formed."}, {"label": "I.3", "text": "3 - Give two characteristics."}]
check("the next part's answer inside this one (gs/2005 2/chem_en.pdf)",
      bool(pp.misplaced_trace(leaky, by("2- The ester is propyl ethanoate. 3- This reaction is slow.", "slow"))))
check("the next part's number opening a maths span (gs/2004 1 physics_fr A.1)",
      bool(pp.misplaced_trace([{"label": "A.1", "text": "1) Justify."}, {"label": "A.2", "text": "2) a) Find."}],
                              by("$1-E_1=-13.6$ discontinuous. $2-\\mathrm{a}) E_f$ n=1", "x"))))
check("an answer of its own passes", not pp.misplaced_trace(leaky, by("The ester is propyl ethanoate.", "slow")))

print("rows the model placed")
check("a row keeps its own letter on the part it extends",
      pp.placed_tokens(("A", "2", "A"), "A.2") == ("A", "2", "A"))
check("'2.a' placed on 'B.2' keeps its a",
      pp.placed_tokens(("2", "A"), "B.2") == ("B", "2", "A"))
check("a row with no letter takes the part's label", pp.placed_tokens(("I", "2"), "II.2") == ("II", "2"))
check("a part's printed sub-questions",
      pp.printed_letters("1. a) Determine the period\n\nb) Determine the maximum\n\nc) Calculate the phase") == ["a", "b", "c"])
check("a line's name is not a sub-question",
      pp.printed_letters("4) Designate by (d) the line. a- Give (d). b- Calculate. c- Prove.") == ["a", "b", "c"])

parts = [{"label": "B.1"}, {"label": "B.2"}]
texts = {"B.1": "1. a) Determine the period\n\nb) the maximum\n\nc) the phase", "B.2": "2. Knowing that i"}
rows = [{"rid": r, "tokens": t, "answer": ""} for r, t in
        [("A", ("A",)), ("a", ("B", "1", "A")), ("b", ("B", "1", "B")), ("c", ("B", "1", "C")), ("x", ("B", "2"))]]
placed = [rows[0], rows[4]]
check("the model passing over B.1.a, B.1.b, B.1.c for another row is refused (gs/2004 2/phy_en.pdf)",
      pp.ignores_named_rows(parts, texts, rows, placed, {"A": (2, "B.1"), "x": (2, "B.2")}))
check("the same rows placed where their labels say pass",
      not pp.ignores_named_rows(parts, texts, rows, rows[1:], {"a": (2, "B.1"), "b": (2, "B.1"), "c": (2, "B.1"), "x": (2, "B.2")}))

print()
if FAILURES:
    print(f"{len(FAILURES)} failure(s): {', '.join(FAILURES)}")
    sys.exit(1)
print("all fixtures passed")
