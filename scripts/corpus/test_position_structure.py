# -*- coding: utf-8 -*-
"""Fixtures for position_structure — academic container -> positioned source.

    python scripts/corpus/test_position_structure.py

C1 only. These test where an already-extracted exercise was printed, never which
figure belongs to it; figure cases belong to the next layer.

Each case builds a small `lines.json` in the shape Mathpix actually writes —
pages carrying `page_height`, lines carrying `text` and a `region` — and feeds it
through `build_containers`, the same code path the corpus run uses. Where a case
comes from a real paper, the paper is named.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8")

from position_structure import build_containers  # noqa: E402

FAILURES = []


def check(name, ok, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f" — {detail}"))
    if not ok:
        FAILURES.append(name)


def paper(*pages):
    """pages: list of lists of (y, text)."""
    return {"pages": [
        {"page": i + 1, "page_height": 3300, "page_width": 2400,
         "lines": [{"text": t, "region": {"top_left_x": 100, "top_left_y": y,
                                          "width": 2000, "height": 60}} for y, t in lines]}
        for i, lines in enumerate(pages)
    ]}


def run(data, exercises):
    """(alignment, spans) per exercise — through the corpus run's own code path."""
    out = []
    for c in build_containers(exercises, data):
        a = dict(c["alignment"])
        a["anchor"] = a.pop("anchorToken")
        out.append((a, c["spans"]))
    return out


def run_full(data, exercises):
    return build_containers(exercises, data)


def ex(title, statement):
    return {"title": title, "statement": statement, "parts": []}


LONG1 = "a gun shoots a bullet of mass ten grams towards a block considered as a particle"
LONG2 = "a solid of mass two hundred grams is launched with a speed of four metres per second"
LONG3 = "an rlc series circuit is fed by a generator delivering an alternating sinusoidal voltage"

# 1 ------------------------------------------------------------------------
print("two exercises on one page")
d = paper([(100, "Exercise 1 (5 points) Linear momentum"), (200, LONG1),
           (1500, "Exercise 2 (5 points) Mechanical energy"), (1600, LONG2)])
r = run(d, [ex("Linear momentum", LONG1), ex("Mechanical energy", LONG2)])
check("both placed", all(a["anchor"] is not None for a, _ in r))
check("ex1 on p1 above ex2", r[0][1][0]["page"] == 1 and r[0][1][0]["yStart"] < r[1][1][0]["yStart"])
check("ex1 stops before ex2 begins", r[0][1][-1]["yEnd"] < r[1][1][0]["yStart"])

# 2 ------------------------------------------------------------------------
print("\nexercise spanning pages")
d = paper([(100, "Exercise 1 (6 points) Oscillations"), (200, LONG3), (3000, "continued on the next page")],
          [(150, "determine the resonance frequency and the quality factor"),
           (900, "Exercise 2 (4 points) Nuclear physics"), (1000, LONG2)])
r = run(d, [ex("Oscillations", LONG3), ex("Nuclear physics", LONG2)])
spans = r[0][1]
check("ex1 has one segment per page", [s["page"] for s in spans] == [1, 2], str([s["page"] for s in spans]))
check("page-2 segment ends before ex2 heading", spans[1]["yEnd"] < 900, str(spans[1]))
check("no segment claims a second page", all("page" in s and isinstance(s["page"], int) for s in spans))

# 3 ------------------------------------------------------------------------
print("\nnormalised title differs from the printed heading")
d = paper([(100, "EXERCICE N° 1 — ( 5 pts )  :  Chute libre d'une bille"), (200, LONG1)])
r = run(d, [ex("Chute libre", LONG1)])
check("placed via body tokens", r[0][0]["anchor"] is not None and r[0][0]["status"] in ("EXACT", "STRONG"),
      str(r[0][0]))

# 4 ------------------------------------------------------------------------
print("\nline-wrapped heading")
d = paper([(100, "Exercise 3 (6.5 points) Emission spectrum of"), (160, "the hydrogen atom"), (260, LONG3)])
r = run(d, [ex("Emission spectrum of the hydrogen atom", LONG3)])
check("placed on the heading's first line", r[0][1] and r[0][1][0]["yStart"] <= 160, str(r[0][1]))

# 5 ------------------------------------------------------------------------
print("\nArabic presentation forms")
# Printed with presentation-form glyphs (what a PDF emits); extracted as base letters.
printed = "ﺍﻟﺘﻤﺮﻳﻦ ﺍﻷﻭﻝ"   # التمرين الأول, presentation forms
body = "احسب سرعة الجسم عند وصوله إلى النقطة ب ثم استنتج قيمة الطاقة الحركية"
d = paper([(100, printed), (200, body)])
r = run(d, [ex("التمرين الأول", body)])
check("folded alignment places it", r[0][0]["anchor"] is not None, str(r[0][0]))

print("\nArabic text-layer quirks")
# The canonical Geography text (the PDF's own text layer) writes heh as U+06BE
# and puts a space before a combining mark ("حد ِّد"); Mathpix prints ه and
# "حدِّد". Taken from gs/2006 1/gs geo 1.pdf.
canon = "أوضِح بفكرتين دور المؤسسات المالية الكبرى التي يمتلكھا عالم الشمال في تعزيز ھيمنته على الاقتصاد العالمي حد ِّد"
printed = "أوضِح بفكرتين دور المؤسسات المالية الكبرى التي يمتلكها عالم الشمال في تعزيز هيمنته على الاقتصاد العالمي حدِّد"
d = paper([(100, "السؤال الأول"), (200, printed)])
r = run(d, [ex("", canon)])
check("every token matches despite heh form and split marks", r[0][0]["score"] == 1.0, str(r[0][0]))

# 6 ------------------------------------------------------------------------
print("\nempty derived title recovered from body")
d = paper([(100, "II- ( 4 points)"), (200, LONG2)])
r = run(d, [ex("", LONG2)])
check("placed by statement alone", r[0][0]["anchor"] is not None and r[0][0]["status"] in ("EXACT", "STRONG"))
check("span starts at its bare heading line", r[0][1][0]["yStart"] == 100, str(r[0][1]))
d = paper([(100, LONG1), (1400, "Exercise 2 (5 points)"), (1500, LONG2)])
r = run(d, [ex("", LONG1), ex("", LONG2)])
check("next exercise's heading is not the previous one's tail",
      r[0][1][-1]["yEnd"] < 1400 and r[1][1][0]["yStart"] == 1400, str(r))

# 7 ------------------------------------------------------------------------
print("\nrepeated phrase in the marking scheme")
d = paper([(100, "Exercise 1 (5 points)"), (200, LONG1),
           (1500, "Exercise 2 (5 points)"), (1600, LONG2)],
          [(100, "Marking scheme"), (200, LONG1), (400, LONG2)])
r = run(d, [ex("", LONG1), ex("", LONG2)])
check("ex1 anchored on page 1, not the scheme", r[0][1][0]["page"] == 1, str(r[0][1][0]))
check("ex2 anchored on page 1, not the scheme", r[1][1][0]["page"] == 1, str(r[1][1][0]))

# 8 ------------------------------------------------------------------------
print("\nmultiple plausible regions")
same = "calculate the value of the current intensity in the circuit"
d = paper([(100, same), (200, "some unrelated text here"), (1500, same)])
r = run(d, [ex("", same)])
check("not EXACT when the phrase occurs twice", r[0][0]["status"] != "EXACT", str(r[0][0]))

# 9 ------------------------------------------------------------------------
print("\nbody alignment without any heading line")
d = paper([(100, LONG3), (400, LONG2)])
r = run(d, [ex("Some title never printed", LONG3), ex("Another unprinted title", LONG2)])
check("both placed in order", r[0][0]["anchor"] is not None and r[1][0]["anchor"] is not None
      and r[0][0]["anchor"] < r[1][0]["anchor"])

# 10 -----------------------------------------------------------------------
print("\nfirst exercise at the top of the first page")
d = paper([(40, "Exercise 1 (5 points) Capacitor"), (120, LONG3)])
r = run(d, [ex("Capacitor", LONG3)])
check("starts on page 1 near the top", r[0][1][0]["page"] == 1 and r[0][1][0]["yStart"] <= 120)

# 11 -----------------------------------------------------------------------
print("\nfinal exercise extends to the end of the paper")
d = paper([(100, "Exercise 1 (5 points)"), (200, LONG1)],
          [(100, "Exercise 2 (5 points)"), (200, LONG2), (2900, "End of paper")])
r = run(d, [ex("", LONG1), ex("", LONG2)])
last = r[1][1][-1]
check("last container reaches the final line", last["page"] == 2 and last["yEnd"] >= 2900, str(last))

# 12 -----------------------------------------------------------------------
print("\nordering is monotonic")
d = paper([(100, LONG2), (400, LONG1)])
# Extraction says LONG1 comes first; the paper prints LONG2 first. The aligner
# must not go backwards to satisfy exercise 2 after placing exercise 1.
r = run(d, [ex("", LONG1), ex("", LONG2)])
a1, a2 = r[0][0]["anchor"], r[1][0]["anchor"]
check("never places a later exercise above an earlier one", a2 is None or a1 is None or a2 > a1,
      f"{a1} {a2}")

# 13 -----------------------------------------------------------------------
print("\na common first word shortly before the real occurrence")
# Page 1 ends on a line starting with "a"; the real exercise opens page 2 with
# "a tourist agency ...". A window that may stretch over dozens of tokens began
# at the stray "a", collected every probe token from the real line, scored 1.0,
# and — being earlier — won the tie. The true heading then looked like a rival.
tour = "a tourist agency offers its customers two choices of seven day voyages full board"
d = paper([(100, "Exercise 1 (5 points)"), (200, LONG1), (3000, "a system of parametric equations of the line")],
          [(100, tour), (200, "calculate the probability that the customer chose the first voyage")])
r = run(d, [ex("", LONG1), ex("", tour)])
check("placed on page 2, not on the stray word", r[1][1] and r[1][1][0]["page"] == 2, str(r[1][1][:1]))
check("real occurrence is EXACT, not its own rival", r[1][0]["status"] == "EXACT", str(r[1][0]))

# 13b ----------------------------------------------------------------------
print("\nthe probe's first word ends the previous exercise")
# gs/2024 1/SG_Phys_2024_1_En.pdf: page 1 ends "Deduce whether the ball reaches
# the hole"; page 2 opens "The aim of this exercise ...". Starting at that last
# "the", every probe token is still within slack, so it tied at 100% — and the
# earlier start won. The real start matches with no skipped tokens.
aim = "the aim of this exercise is to determine the capacitance of a capacitor in a level sensor"
d = paper([(100, "Exercise 1 (5 points)"), (200, LONG1), (3000, "2.4) Deduce whether the ball reaches the hole")],
          [(179, aim), (300, "read carefully document five then answer the questions")])
r = run(d, [ex("", LONG1), ex("", aim)])
check("starts at 'The aim', page 2", r[1][1] and r[1][1][0]["page"] == 2 and r[1][1][0]["yStart"] == 179,
      str(r[1][1][:1]))
check("exercise 1 keeps its last line", r[0][1][-1]["yEnd"] >= 3000, str(r[0][1]))

# 14 -----------------------------------------------------------------------
print("\nformula rendered differently by the two readers")
# The canonical text comes from the PDF's own text layer, where a formula is
# glyph soup; the positioned lines come from Mathpix, where it is LaTeX. Taken
# from gs/2007 2/math_fr.pdf, which scored 50% on the right line.
d = paper([(100, "Exercice 1 (4 points)"), (200, LONG1)],
          [(1530, "\\item[A] - On considère l'équation différentielle $(I): x y^{\\prime}-y=1-2 \\ln x$."),
           (1600, "\\item[1] - Vérifier que $y_{1}=1+2 \\ln x$ est une solution particulière de l'équation $(I)$.")])
canon = ("A- On considère l’équation différentielle ( ) : ' 1 2 ln−= −I xy y x . \n"
         "1- Vérifier que 1 1 2 ln= +yx est une solution particulière de l’équation )(I .")
r = run(d, [ex("", LONG1), ex("", canon)])
check("placed on the right line", r[1][1] and r[1][1][0]["page"] == 2 and r[1][1][0]["yStart"] == 1530,
      str(r[1][1][:1]))
check("and confidently", r[1][0]["status"] == "EXACT", str(r[1][0]))

# 15 -----------------------------------------------------------------------
print("\nmarking scheme folded into the last exercise")
# ls/2018 1/bio_en.pdf: the extractor's exercise 2 ends with the scheme for
# exercise 1. The container keeps its text; its statement territory stops at
# the scheme heading, and the scheme is kept apart.
d = paper([(100, "Exercise 1 (5 points)"), (200, LONG1), (1500, "Exercise 2 (5 points)"), (1600, LONG2)],
          [(100, "\\section*{Marking Scheme}"), (200, "Q1 the allele of the disease is recessive"),
           (900, "\\begin{tabular} Q & Answer & Mark \\\\ 1 & the solid is launched \\end{tabular}")])
c = run_full(d, [ex("", LONG1), ex("", LONG2 + " marking scheme q1 the allele of the disease is recessive")])
check("statement span stays on page 1", [s["page"] for s in c[1]["spans"]] == [1], str(c[1]["spans"]))
check("scheme kept, on page 2", [s["page"] for s in c[1]["trailingSpans"]] == [2], str(c[1]["trailingSpans"]))
check("earlier exercise untouched", c[0]["trailingSpans"] == [] and c[0]["spans"][-1]["yEnd"] < 1500)

# 16 -----------------------------------------------------------------------
print("\nthe word 'correction' in a statement is not a scheme")
d = paper([(100, "Exercise 1 (5 points)"), (200, LONG1),
           (400, "apply the correction factor to the measured intensity"), (600, "determine the error")])
c = run_full(d, [ex("", LONG1)])
check("no split on prose", c[0]["trailingSpans"] == [] and c[0]["spans"][-1]["yEnd"] >= 600, str(c[0]))

# 17 -----------------------------------------------------------------------
print("\nscheme between two language copies")
# ls/2015 1/math_fr.pdf prints French, then English, then Arabic. A paper that
# prints FR, FR scheme, EN must not put the English exercise in scheme territory.
d = paper([(100, "Premier exercice (5 points)"), (200, "un solide de masse deux cents grammes est lancé avec une vitesse de quatre mètres")],
          [(100, "Barème"), (200, "Q1 réponse attendue un solide lancé")],
          [(100, "Exercise 1 (5 points)"), (200, LONG2)])
c = run_full(d, [ex("", "un solide de masse deux cents grammes est lancé avec une vitesse de quatre mètres"),
                 ex("", LONG2)])
check("French span stops before its scheme", [s["page"] for s in c[0]["spans"]] == [1], str(c[0]["spans"]))
check("French scheme recorded", [s["page"] for s in c[0]["trailingSpans"]] == [2])
check("English exercise is statement territory", [s["page"] for s in c[1]["spans"]] == [3]
      and c[1]["trailingSpans"] == [], str(c[1]))

# 17b ----------------------------------------------------------------------
print("\nscheme with no scheme heading, only restarted exercise headings")
# gs/2006 2/phy_en.pdf: after the fourth exercise, page 5 prints "First exercise :
# (6 1/2 pts)" and its answers. No word says "scheme"; the restart does.
d = paper([(100, "First exercise: (7 pts) Mechanical oscillations"), (200, LONG1),
           (1500, "Second exercise: (7 pts) Nuclear physics"), (1600, LONG2)],
          [(100, "First exercise : ( 6 1/2 pts)"), (200, "1) connection of the oscilloscope as shown")])
c = run_full(d, [ex("Mechanical oscillations", LONG1), ex("Nuclear physics", LONG2)])
check("last exercise stops at the restarted heading", [s["page"] for s in c[1]["spans"]] == [1], str(c[1]["spans"]))
check("the rest is trailing, with a reason", [s["page"] for s in c[1]["trailingSpans"]] == [2]
      and c[1]["endReason"] == "unclaimed-heading", str(c[1]))
check("first exercise ends at the next container", c[0]["endReason"] == "next-container")

# 17c ----------------------------------------------------------------------
print("\ntitle printed above its own 'Exercise 1' line")
# ls/2018 1/bio_en.pdf prints "Diagnosis of Galactosemia" then "Exercise 1 (5.5
# points)". The heading just below the anchor is the container's own.
d = paper([(100, "Diagnosis of Galactosemia"), (160, "Exercise 1 (5.5 points)"), (260, LONG1), (900, LONG3)])
c = run_full(d, [ex("Diagnosis of Galactosemia", LONG1 + " " + LONG3)])
check("own heading does not end the span", c[0]["spans"][-1]["yEnd"] >= 900 and c[0]["trailingSpans"] == [],
      str(c[0]))

# 17c2 ---------------------------------------------------------------------
print("\nheading and passage the extraction left out of the next exercise")
# lh/2016 2/bio_en.pdf: "Exercise 2 (7 points)", a reading passage, then
# "1- Show that ..." — where the extracted statement begins. The passage is
# not exercise 1's, and not exercise 2's extracted text either: it is recorded
# as exercise 2's lead-in, apart from its statement territory.
passage = "tobacco smoke contains many toxic substances that pollute closed places where people gather"
d = paper([(100, "Exercise 1 (5 points)"), (200, LONG1), (1500, "Exercise 2 (7 points)"),
           (1600, passage), (1900, "1- Show that certain places in Lebanon are highly polluted by tobacco smoke")])
c = run_full(d, [ex("", LONG1), ex("", "1- Show that certain places in Lebanon are highly polluted by tobacco smoke")])
check("exercise 1 stops at the heading", c[0]["endReason"] == "unclaimed-heading" and c[0]["spans"][-1]["yEnd"] < 1500)
check("exercise 2 gets the lead-in", [(s["yStart"], s["yEnd"]) for s in c[1]["leadInSpans"]] == [(1500, 1660)],
      str(c[1].get("leadInSpans")))
check("statement territory is still only its own text", c[1]["spans"][0]["yStart"] == 1900)

print("\nregion of a missing container is nobody's lead-in")
# gs/2008 2/phy_en.pdf: exercise 2 was not placed; exercise 3 anchors on its own
# heading. What lies before it is exercise 2's, not exercise 3's lead-in.
d = paper([(100, "First exercise (7 points)"), (200, LONG1), (1500, "Second exercise (7 points)"),
           (1600, passage)],
          [(100, "Third exercise (6 points) Nuclear physics"), (200, LONG2)])
c = run_full(d, [ex("", LONG1), ex("", "zzz qqq www never printed anywhere here at all"),
                 ex("Nuclear physics", LONG2)])
check("no lead-in for exercise 3", c[2]["leadInSpans"] == [], str(c[2].get("leadInSpans")))
# Same, where exercise 3 anchors on a body line rather than its heading
# (lh/2021 1/SELH_Bio_2021_1_Fr_0.pdf): an unplaced container in between still
# means the region may be its.
d = paper([(100, "Exercice 1 (5 points)"), (200, LONG1), (1500, "Exercice 2 (7 points)"), (1600, passage)],
          [(100, "Document 1"), (200, LONG2)])
c = run_full(d, [ex("", LONG1), ex("", "zzz qqq www never printed anywhere here at all"), ex("", "document " + LONG2)])
check("no lead-in across an unplaced container", c[2]["leadInSpans"] == [], str(c[2].get("leadInSpans")))

# 17d ----------------------------------------------------------------------
print("\nexercise headings, from real lines")
from position_structure import is_exercise_heading  # noqa: E402
yes = ["Exercise 3 (5 pts)", "\\section*{Exercice 2 (7 points)}", "\\section*{Second exercise: (7pts) Iodine}",
       "Deuxième exercice (7 points) Radioactivité en médecine", "IV- (8 points)", "\\section*{V- ( 3 points)}",
       "Exercise 2 ( $\\mathbf{7 . 5}$ points)", "التمرين الثاني (7 علامات)", "Exercice N° 3 (6 points)"]
no = ["point A", "problem, an oscilloscope, a resistor of resistance $\\mathrm{R}=10 \\Omega$",
      "au point A (1 ; 0 ; 1).", "points T et S.", "exercice est de déterminer le rendement de cette centrale.",
      "« ...Le problème de l'embouteillage est devenu l'une des préoccupations", "1) Au point A :",
      "(2pts)", "Exercise 1 of the previous session showed that", "In exercise 2 we saw"]
yes += ["\\begin{table} \\captionsetup{labelformat=empty} \\caption{First exercise (7 points)} \\begin{tabular}",
        "\\begin{tabular}[t]{|l|l|l|} \\hline \\multicolumn{3}{|l|}{Exercise 1 (7 points) The synthesis}",
        "\\section*{Question III (4pts)}", "\\section*{Deuxième question (7 points)"]
no += ["Question 2 : calculate the speed", "1- Answer the question below"]
for line in yes:
    check(f"heading: {line[:40]}", is_exercise_heading(line))
for line in no:
    check(f"not a heading: {line[:40]}", not is_exercise_heading(line))

# 17d2 ---------------------------------------------------------------------
print("\na scheme page opening with a short line above its heading")
# SV_Phys_2022_1_En.pdf: page 4 opens "مسابقة في مادة الفيزياء", then
# "أسس التصحيح - إنكليزي". The subject line is the scheme cover's, not the
# last exercise's. And the same exercise's own last line, on the scheme's page,
# stays with it.
d = paper([(100, "Exercise 1 (5 points)"), (200, LONG1), (1500, "Exercise 2 (5 points)"), (1600, LONG2),
           (3000, "Justify your answer.")],
          [(260, "مسابقة في مادة الفيزياء"), (310, "أسس التصحيح - إنكليزي"), (440, "Exercise 1 (6 pts)")])
c = run_full(d, [ex("", LONG1), ex("", LONG2)])
check("scheme cover's first line is not the exercise's", [s["page"] for s in c[1]["spans"]] == [1], str(c[1]["spans"]))
check("the exercise keeps its own last line", c[1]["spans"][-1]["yEnd"] >= 3000)
d = paper([(100, "Exercise 1 (5 points)"), (200, LONG1), (1500, "Exercise 2 (5 points)"), (1600, LONG2),
           (1700, "Deduce c."), (1800, "Barème")])
c = run_full(d, [ex("", LONG1), ex("", LONG2)])
check("a short last line above a scheme heading on the same page stays", c[1]["spans"][-1]["yEnd"] >= 1700,
      str(c[1]["spans"]))

# 17d3 ---------------------------------------------------------------------
print("\ntwo containers inside one printed line")
# gs/2007 1/geo.pdf: Mathpix emits the whole question table as one line, and
# three containers align inside it. The page says only "somewhere in this
# line", so none of them may claim a position finer than that.
q1 = "حدد طبيعة المستندين وموضوع كل منهما واقترح عنوانا مناسبا لكل منهما"
q2 = "استنتج اثنين من مظاهر التباين بين عالمي الشمال والجنوب محددا المؤشر الذي اعتمدته"
d = paper([(100, "الأسئلة"), (212, q1 + " " + q2)])
c = run_full(d, [ex("", q1), ex("", q2)])
check("both placed on the shared line", all(x["spans"] and x["spans"][0]["yStart"] == 212 for x in c), str(c))
check("neither is EXACT or STRONG", all(x["alignment"]["status"] == "AMBIGUOUS" for x in c),
      str([x["alignment"] for x in c]))
check("evidence names the reason", all("shares" in x["alignment"]["evidence"] for x in c))

# 17e ----------------------------------------------------------------------
print("\nexam header printed again")
# gs/2019 1/math_en.pdf: the last exercise runs on; page 4 opens with the exam
# header "دورة العام 2019 العادية" — the scheme's cover.
from position_structure import is_paper_header  # noqa: E402
check("header: دورة العام 2019 العادية", is_paper_header("دورة العام 2019 العاديّة"))
check("header: PREMIERE SESSION", is_paper_header("\\section*{PREMIERE SESSION 2006}"))
check("header in a scheme table cell", is_paper_header(
    "\\begin{tabular}[t]{|l|l|l|} \\hline ₹ Q1 & MATH SV | PREMIERE SESSION-2007 & No tes \\\\ \\hline 1-a & x"))
check("header: امتحانات الشهادة الثانوية", is_paper_header("امتحانات الشهادة الثانوية العامة"))
check("not a header: a sentence about sessions", not is_paper_header("During the first session of training, the athlete ran"))
d = paper([(100, "Exercise 1 (5 points)"), (200, LONG1), (1500, "Exercise 2 (5 points)"), (1600, LONG2)],
          [(100, "دورة العام 2019 العادية"), (200, "1 & the solid is launched & 0.5")])
c = run_full(d, [ex("", LONG1), ex("", LONG2)])
check("last exercise stops at the reprinted header", [s["page"] for s in c[1]["spans"]] == [1]
      and c[1]["endReason"] == "paper-header", str(c[1]))

# 18 -----------------------------------------------------------------------
print("\nscheme markers, from real lines")
from position_structure import is_scheme_marker  # noqa: E402
yes = ["\\begin{tabular}[t]{|l|l|l|} \\hline Part of the ex & Answer key & Mark",
       "\\begin{table} \\captionsetup{labelformat=empty} \\caption{Barème} \\begin{tabular}",
       "\\section*{Math-Bareme-Session 1-2013}",
       "\\begin{tabular}[t]{|l|l|l|l|} \\hline I & \\multicolumn{2}{|c|}{Corrigé} & Note",
       "\\hline Partie de la Q. & Corrigé & Note \\\\",
       "مشروع أسس التصحيح",
       "\\caption{Marking Scheme of Chemistry}",
       "\\begin{tabular}[t]{|l|l|l|} \\hline Q. & Exercise 1 & mark \\\\ \\hline 1-",
       "\\section*{أسس تصحيح مادّة الجغر افيا}",
       "\\section*{أسس تصحيح مسابقة \"علوم الحياة\"}",
       "\\section*{Réponses}",
       "\\begin{tabular}[t]{|l|l|l|} \\hline Q.IV & Answers & Mark \\\\",
       "\\begin{tabular}[t]{|l|l|l|} \\hline III & Answers & \\\\",
       "\\begin{tabular}[t]{|l|l|l|} \\hline Q.VI & Eléments de réponse & Note \\\\",
       "\\begin{tabular}[t]{|l|l|l|l|} \\hline \\multicolumn{4}{|l|}{GENERAL SCIENCES MATH} \\\\ \\hline & & Short answers & M \\\\",
       "\\begin{tabular}[t]{|l|l|l|} \\hline Part of the ex. & Exercise 1 Dysuria & Grade 5 pts \\\\ \\hline 1 & x",
       "\\begin{tabular}[t]{|l|l|} \\hline Expected Answers & Comments \\\\ \\hline I-",
       "\\begin{tabular}[t]{|l|l|} \\hline Réponses attendues & Remarques \\\\ \\hline I-"]
no = ["Indiquer les expressions correctes et corriger celles qui ne le sont pas.",
      "\\item[2.] Corriger les deux phrases suivantes :",
      "Answer the following questions using the documents",
      "Apply the correction factor to the measured intensity.",
      "\\begin{tabular}[t]{|l|l|l|l|l|l|} \\hline \\multirow{2}{*}{No} & \\multirow{2}{*}{Questions} & "
      "\\multicolumn{4}{|c|}{Answers} \\\\ \\hline & & a & b & c & d",
      "Justifier vos réponses.",
      "\\begin{tabular}[t]{|l|l|l|} \\hline i & n & t \\\\ \\hline 0.5 & 2 & 10",
      "\\begin{tabular} \\hline No & Questions & \\multicolumn{3}{|c|}{Answers} \\\\ \\hline & & a & b & c "
      "\\\\ \\hline 1 & if u is & i & ii & m \\\\ \\hline 2 & the limit & n & 0 & 1",
      "\\begin{tabular} \\hline No & Questions & Answers \\\\",
      "\\item[3.] Répondre par vrai ou faux aux propositions suivantes. Corriger les fausses."]
for line in yes:
    check(f"marker: {line[:48]}", is_scheme_marker(line))
for line in no:
    check(f"not a marker: {line[:44]}", not is_scheme_marker(line))

print()
if FAILURES:
    print(f"{len(FAILURES)} failure(s): {', '.join(FAILURES)}")
    sys.exit(1)
print("all fixtures passed")
