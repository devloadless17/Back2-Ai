# -*- coding: utf-8 -*-
"""Fixtures for lang_parts — a language paper's printed lines read as questions.

    python scripts/corpus/test_lang_parts.py

Each line is printed on a real GS paper, named beside it.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8")

import lang_parts as lp  # noqa: E402

FAILURES = []


def check(name, ok, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f" — {detail}"))
    if not ok:
        FAILURES.append(name)


def split(name, line, want):
    got = lp.split_columns(line)
    check(name, got == want, got)


print("two columns on one line")
split("numbers across columns (gs/2013 2/eng.pdf)", "1. it (Paragraph 6) 3. s/he (Paragraph 7)",
      ["1. it (Paragraph 6)", "3. s/he (Paragraph 7)"])
split("a word list (gs/2013 2/eng.pdf)", "1. yield to 3. an article of trade",
      ["1. yield to", "3. an article of trade"])
split("a run of four", "1. That (Paragraph 1) 2. that (Paragraph 2) 3. it (Paragraph 4) 4. they (Paragraph 5)",
      ["1. That (Paragraph 1)", "2. that (Paragraph 2)", "3. it (Paragraph 4)", "4. they (Paragraph 5)"])
split("letters", "a. Paragraphs 5 and 6 b. Paragraphs 7 and 8",
      ["a. Paragraphs 5 and 6", "b. Paragraphs 7 and 8"])

print("not two columns")
split("a paragraph range (gs/2013 2/eng.pdf)",
      "3. Identify the thematic relation between Paragraphs 2 and 13. Justify your answer. (Score: 01)",
      ["3. Identify the thematic relation between Paragraphs 2 and 13. Justify your answer. (Score: 01)"])
split("a paragraph number", "1. In reference to Paragraph 2. what do you infer",
      ["1. In reference to Paragraph 2. what do you infer"])
split("a number range", "2. Read lines 1 to 3. Then answer", ["2. Read lines 1 to 3. Then answer"])
split("a list of paragraphs", "1. Scan Paragraphs 2, 3. and 4. to find", ["1. Scan Paragraphs 2, 3. and 4. to find"])
split("a section heading is left whole", "C. 1. Identify the figure of speech",
      ["C. 1. Identify the figure of speech"])

print("blank boxes and lone headings")
check("a diagram's blank boxes", bool(lp.LABEL_ONLY.match("1. 1.")) and bool(lp.LABEL_ONLY.match("2. 2.")))
check("a short question is kept", not lp.LABEL_ONLY.match("1. it (Paragraph 6)"))
check("a section letter alone (gs/2013 2/eng.pdf)", bool(lp.SECTION_ALONE.match("B.")))
check("a question is not a lone section", not lp.SECTION_ALONE.match("B. Answer the following."))

print("print order")
items = [{"label": l, "text": l} for l in ["I.D", "I.D.1", "I.D.3", "I.D.2", "I.D.4", "I.E", "I.E.1"]]
order = [it["label"] for it in lp.in_print_order(items)]
check("two columns read across, put back in order", order == ["I.D", "I.D.1", "I.D.2", "I.D.3", "I.D.4", "I.E", "I.E.1"], order)
items = [{"label": l, "text": l} for l in ["I.A.1", "I.A.2", "I.A.1"]]
order = [it["label"] for it in lp.in_print_order(items)]
check("a repeated label is not sorted away", order == ["I.A.1", "I.A.2", "I.A.1"], order)

print("lettered answers")
got = lp.letter_lines("Choix de la bonne réponse a- Le personnage est X. b- Sur les lieux, Y. c- On a abîmé Z.")
check("one line per letter (gs/2019/fr.pdf)", got.split("\n\n") == [
    "Choix de la bonne réponse", "a- Le personnage est X.", "b- Sur les lieux, Y.", "c- On a abîmé Z."], got)
got = lp.letter_lines("Vitamin b. is not a list")
check("a lone letter stays prose", got == "Vitamin b. is not a list", got)
got = lp.letter_lines("Il y a. Puis c. ensuite")
check("letters out of order stay prose", got == "Il y a. Puis c. ensuite", got)

print("labels the text layer squeezed")
check("a section and its first number on one line (gs/2004 2/eng.pdf)",
      lp.section_then_number("A. 1. The objective of the 1999 National Summit") == ["A.", "1. The objective of the 1999 National Summit"])
check("no space after the label (gs/2015 1/french.pdf)", bool(lp.LINE_LABEL.match("5-Relevezles énumérations")))
check("a number then a letter, no space", bool(lp.LINE_LABEL.match("4-a.Relevezles groupes verbaux")))
check("an en dash (gs/2009 2/fr.pdf)", bool(lp.LINE_LABEL.match("3– a. Après avoir identifié la figure")))
check("a decimal is not a label", not lp.LINE_LABEL.match("1.5 pt pour la justification"))
check("Questions heading with an en dash (gs/2008 1/french.pdf)", bool(lp.QUESTIONS_HEAD.match("I– Questions (13 pts)")))

print("choices, writing rows, language")
items = lp.labelled(["2- Lisez le texte puis choisissez :", "A- En relisant la citation", "B- Au XXIème siècle :", "3- Le thème"])
check("capitals under a number are its choices (gs/2017 2/fr.pdf)",
      [i["label"] for i in items] == ["I.2", "I.2.A", "I.2.B", "I.3"], [i["label"] for i in items])
items = lp.labelled(["A. Answer the following.", "1. What is it?", "B. Find words."])
check("capitals before any number are sections", [i["label"] for i in items] == ["I.A", "I.A.1", "I.B"], [i["label"] for i in items])
rows = [{"tokens": t} for t in [("I", "A", "1"), ("I", "E", "4"), ("I", "A"), ("I", "B")]]
check("a section letter going back starts the writing grid (gs/2017 1/eng.pdf)", len(lp.reading_rows(rows)) == 2)
check("French text is French", lp.written_in("Le candidat relève les termes et les expressions dans le texte") == "fr")
check("English text is English", lp.written_in("The writer uses a lot of questions in the selection and the reader") == "en")

print(f"\n{len(FAILURES)} failure(s)")
sys.exit(1 if FAILURES else 0)
