# -*- coding: utf-8 -*-
"""Fixtures for figure_ownership — semantic ownership of figure occurrences.

    python scripts/corpus/test_figure_ownership.py

Each case builds a canonical exercise and a C2-shaped occurrence and runs them
through the same `caption_identity` / `exercise_facts` / `resolve` the corpus
run uses. Where a case comes from a real paper, the paper is named. Real-paper
checks against the generated artifact run last and are skipped, loudly, when
it is absent.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8")

from figure_ownership import (OUT_FILE, caption_identity, exercise_facts, references,  # noqa: E402
                              resolve)

FAILURES = []


def check(name, ok, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f" — {detail}"))
    if not ok:
        FAILURES.append(name)


def ex(statement, *parts):
    return {"title": "", "statement": statement,
            "parts": [{"label": lab, "text": txt} for lab, txt in parts]}


def occ(*cands, conf=None):
    cs = [{"ordinal": o, "relation": r, "structuralConfidence": "EXACT"} for o, r in cands]
    if conf is None:
        conf = "UNIQUE_GEOMETRIC" if len(cs) == 1 and cs[0]["relation"] == "INSIDE" else \
               "MULTIPLE_GEOMETRIC" if len(cs) > 1 else "WEAK_GEOMETRIC"
    return {"candidates": cs, "geometricConfidence": conf}


def run(o, ident_text, exercises, family="default"):
    ident = caption_identity(ident_text) if ident_text else None
    exs = {i + 1: exercise_facts(e) for i, e in enumerate(exercises)}
    return resolve(o, ident, exs, family, {})


def owner(r):
    return (r["semanticOwner"] or {}).get("containerOrdinals")


# ---------------------------------------------------------------------------
print("captions: identity forms seen in the corpus")
check("Document 2", caption_identity("Document 2")["number"] == 2)
check("Doc. 3", caption_identity("Doc. 3")["number"] == 3)
check("Fig. 1 is a figure, not a document", caption_identity("Fig. 1")["kind"] == "figure")
check("Document 2b keeps its suffix", caption_identity("Document 2b")["suffix"] == "b")
check("a sentence is not a caption",
      caption_identity("Document 2 shows the variation of the membrane potential of the neuron "
                       "as a function of time after a stimulation") is None)
check("Arabic numbered document: المستند رقم $(1)$", caption_identity("المستند رقم $(1)$")["number"] == 1)
check("ε is ٤", caption_identity("المستند رقم $(\\varepsilon)$")["number"] == 4)
r = caption_identity("المستند رقم $(r)$")
check("r is ٢ or ٣: unreadable, not guessed", r["number"] is None and r["numberRaw"] == "r", str(r))
r = caption_identity("المستند رقم $(l-r)$")
check("range with an unreadable end: unreadable", r["number"] is None and r["numberRaw"] == "l-r", str(r))

print("\nreferences: lists and ranges")
nums = sorted(x["number"] for x in references("En se référant aux documents 1 et 2, expliquer"))
check("documents 1 et 2", nums == [1, 2], str(nums))
nums = sorted(x["number"] for x in references("Using documents 1 to 3, explain"))
check("documents 1 to 3", nums == [1, 2, 3], str(nums))
nums = sorted(x["number"] for x in references("من خلال المستندين رقم (1) ورقم (3)، استنتج"))
check("المستندين رقم (1) ورقم (3)", nums == [1, 3], str(nums))

# ---------------------------------------------------------------------------
print("\nnumbered figure + explicit reference")
e = ex("Le but de cet exercice est d'étudier un circuit RC.",
       ("1", "1. Analyser la figure 2 et déterminer la constante de temps ?"),
       ("2", "2. Calculer la capacité C."))
r = run(occ((1, "INSIDE")), "Figure 2", [e])
check("DIRECT, owned by question 1 only",
      (r["semanticConfidence"], r["ownershipLevel"], r["semanticOwner"]["consumedBy"]) ==
      ("DIRECT_REFERENCE", "QUESTION", ["1"]), str(r))

print("\nnumbered document + several referencing questions")
e = ex("Le document 1 montre les résultats d'une expérience.",
       ("1", "1. Analyser le document 1 ?"), ("2", "2. En se référant au document 1, expliquer ?"))
r = run(occ((1, "INSIDE")), "Document 1", [e])
check("EXERCISE_SHARED, introduced in the stimulus",
      (r["ownershipLevel"], r["semanticOwner"]["consumedBy"], r["semanticOwner"]["introducedInStimulus"]) ==
      ("EXERCISE_SHARED", ["1", "2"], True), str(r))

print("\nunnumbered circuit shared by the exercise")
e = ex("On réalise le circuit ci-contre.", ("1", "1. Calculer l'intensité du courant."))
r = run(occ((1, "INSIDE")), None, [e])
check("CORROBORATED, EXERCISE level, no question claimed",
      (r["semanticConfidence"], r["ownershipLevel"]) == ("CORROBORATED", "EXERCISE"), str(r))

print("\nvisual with no textual reference")
e = ex("Soit f la fonction définie sur R par f(x) = x + 1.", ("1", "1. Calculer f(0)."))
r = run(occ((1, "INSIDE")), None, [e])
check("CONTEXTUAL: geometry alone, EXERCISE level",
      (r["semanticConfidence"], r["ownershipLevel"], owner(r)) == ("CONTEXTUAL", "EXERCISE", [1]), str(r))

print("\nthe same document number in two exercises")
e1 = ex("Le document 1 présente un caryotype.", ("1", "1. Analyser le document 1 ?"))
e2 = ex("Le document 1 montre un enregistrement.", ("1", "1. Interpréter le document 1 ?"))
r = run(occ((2, "INSIDE")), "Document 1", [e1, e2])
check("geometry says exercise 2, only it is searched: DIRECT to 2",
      (r["semanticConfidence"], owner(r)) == ("DIRECT_REFERENCE", [2]), str(r))
r = run(occ((1, "BELOW_NEAR"), (2, "ABOVE_NEAR")), "Document 1", [e1, e2])
check("between them, both name a Document 1: AMBIGUOUS", r["semanticConfidence"] == "AMBIGUOUS", str(r))

print("\nC2 MULTIPLE resolved by reference")
e1 = ex("Étude d'une réaction.", ("1", "1. Écrire l'équation ?"))
e2 = ex("Le document 3 montre la courbe.", ("1", "1. Analyser le document 3 ?"))
r = run(occ((1, "BELOW_NEAR"), (2, "ABOVE_NEAR")), "Document 3", [e1, e2])
check("only exercise 2 names Document 3: DIRECT to 2",
      (r["semanticConfidence"], owner(r)) == ("DIRECT_REFERENCE", [2]), str(r))

print("\nC2 MULTIPLE resolved by pointing language (ls/2015 1/chem_fr.pdf)")
e1 = ex("Étude cinétique.", ("2.4", "2.4 - Considérer chacune des trois courbes données ci-après et préciser."))
e2 = ex("Réactions d'hydrolyse. L'eau réagit.", ("1", "1. Tracer la courbe (C) ?"))
r = run(occ((1, "BELOW_NEAR"), (2, "ABOVE_NEAR")), None, [e1, e2])
check("exercise 1 points forward at it; exercise 2's 'courbe (C)' is not pointing",
      (r["semanticConfidence"], owner(r)) == ("CONTEXTUAL", [1]), str(r))

print("\nC2 MULTIPLE that stays ambiguous")
e1 = ex("Étude d'un pendule.", ("1", "1. Calculer la période."))
e2 = ex("Étude d'un condensateur.", ("1", "1. Calculer la charge."))
r = run(occ((1, "BELOW_NEAR"), (2, "ABOVE_NEAR")), None, [e1, e2])
check("nothing separates them: AMBIGUOUS, no owner",
      (r["semanticConfidence"], owner(r)) == ("AMBIGUOUS", None), str(r))

print("\nFrench 'figure ci-dessus' below the figure (gs/2011 1/math_fr.pdf shape)")
e1 = ex("Soit (C) une courbe.", ("1", "1. Montrer que l'abscisse de I est indépendante."))
e2 = ex("Dans la figure ci-dessus, ABCD et AEFG sont deux rectangles directs.", ("1", "1. Déterminer S."))
r = run(occ((1, "BELOW_NEAR"), (2, "ABOVE_NEAR")), None, [e1, e2])
check("exercise V points back at it", (r["semanticConfidence"], owner(r)) == ("CONTEXTUAL", [2]), str(r))
e = ex("Dans la figure ci -dessus, ABCD et AEFG sont deux rectangles directs.", ("1", "1. Déterminer S."))
r = run(occ((1, "INSIDE")), None, [e])
check("'ci -dessus' split by the text layer still counts: CORROBORATED", r["semanticConfidence"] == "CORROBORATED", str(r))

print("\nArabic numbered document across a Geography paper")
g1 = ex("من خلال المستند رقم (1)، استنتج طبيعة العلاقة.")
g2 = ex("يشير المستند رقم (2) الى انخفاض الانتاج.")
g3 = ex("من خلال المستندين رقم (1) ورقم (2)، اشرح.")
r = run(occ((1, "ABOVE_NEAR"), conf="WEAK_GEOMETRIC"), "المستند رقم $(1)$", [g1, g2, g3], family="geography-ar")
check("searched paper-wide; named by containers 1 and 3: PAPER_SHARED",
      (r["semanticConfidence"], r["ownershipLevel"], owner(r)) == ("DIRECT_REFERENCE", "PAPER_SHARED", [1, 3]), str(r))
r = run(occ((1, "ABOVE_NEAR"), conf="WEAK_GEOMETRIC"), "المستند رقم $(r)$", [g1, g2, g3], family="geography-ar")
check("unreadable numeral: UNRESOLVED, nothing guessed",
      (r["semanticConfidence"], owner(r)) == ("UNRESOLVED", None), str(r))

print("\ncaption echo is not a reference")
e = ex("Document 2\nVariation du taux de glucose", ("1", "1. Calculer la glycémie ?"))
facts = exercise_facts(e)
check("a caption printed again on its own line is dropped", facts["refs"] == [], str(facts["refs"]))

print("\nstimulus riding on the previous question")
e = ex("Expérience 1.", ("3", "3. Que peut-on en conclure ? Expérience 2 : les résultats sont dans le document 2."),
       ("4", "4. Indiquer la nature des synapses."))
facts = exercise_facts(e)
roles = sorted({r["role"] for r in facts["refs"] if r["number"] == 2})
check("'document 2' after question 3's '?' is stimulus, not question 3", roles == ["stimulus"], str(facts["refs"]))
e = ex("Préparation d'un savon.", ("2.1", "2.1. En se référant au document-1, écrire la formule semi-développée :"))
roles = sorted({r["role"] for r in exercise_facts(e)["refs"]})
check("a question after its label '2.1.' is the question (ls/2018 2/chem_fr.pdf)", roles == ["question"], str(roles))

print("\nlegacy whole-page association")
from audit_legacy_figures import verdict  # noqa: E402
mine = {"occurrenceId": "a", "semanticConfidence": "DIRECT_REFERENCE", "semanticOwner": {"containerOrdinals": [3]},
        "ownershipLevel": "QUESTION", "scope": "C3"}
prev = {"occurrenceId": "b", "semanticConfidence": "CONTEXTUAL", "semanticOwner": {"containerOrdinals": [2]},
        "ownershipLevel": "EXERCISE", "scope": "C3"}
scheme = {"occurrenceId": "c", "semanticConfidence": None, "semanticOwner": None,
          "ownershipLevel": "SOLUTION_MATERIAL", "scope": "c2-none"}
check("page carries exercise 3's crop: CORRECT", verdict(3, [prev, mine], False) == "CORRECT")
check("page only carries exercise 2's figure (lh/2015 2/bio_fr.pdf): PREVIOUS_OR_NEXT",
      verdict(3, [prev], False) == "PREVIOUS_OR_NEXT")
check("same page is not same visual: exercise 3 owns crops elsewhere → WRONG_PAGE",
      verdict(3, [scheme], True) == "WRONG_PAGE")
check("only scheme material: SCHEME_PAGE", verdict(3, [scheme], False) == "SCHEME_PAGE")
check("no crop on the page: NO_CROP_ON_PAGE", verdict(3, [], False) == "NO_CROP_ON_PAGE")

# ---------------------------------------------------------------------------
print("\nreal papers (from the generated artifact)")
if not OUT_FILE.exists():
    print("  SKIP — run figure_ownership.py first")
else:
    occs = {o["occurrenceId"]: o for o in json.loads(OUT_FILE.read_text(encoding="utf-8"))["occurrences"]}
    scheme = [o for o in occs.values() if o["ownershipLevel"] == "SOLUTION_MATERIAL"]
    check("scheme visuals are solution material, never question evidence",
          scheme and all(o["semanticOwner"] is None for o in scheme))
    header = [o for o in occs.values() if o["scope"] == "non-academic"]
    check("the 13 header banners stay excluded", len(header) == 13 and all(o["ownershipLevel"] == "EXCLUDED" for o in header))
    chem = [o for o in occs.values() if "ls/2015 1/chem_fr.pdf" in o["papers"] and o["c2"]["geometricConfidence"] == "MULTIPLE_GEOMETRIC"]
    check("ls/2015 1/chem_fr.pdf's three curves go to exercise 1",
          len(chem) == 3 and all(owner(o) == [1] for o in chem), str([owner(o) for o in chem]))
    v = occs.get("ea2aff93f02c/347a666434013320")
    check("gs/2011 1/math_fr.pdf 'figure ci-dessus' stays with exercise V", v and owner(v) == [5], str(v and owner(v)))
    geo = [o for o in occs.values() if o.get("family") == "geography-ar" and o["scope"] == "C3"]
    check("no Arabic Geography crop is owned without a direct reference",
          all(o["semanticConfidence"] in ("DIRECT_REFERENCE", "AMBIGUOUS", "UNRESOLVED") for o in geo))

print()
if FAILURES:
    print(f"{len(FAILURES)} failure(s): {', '.join(FAILURES)}")
    sys.exit(1)
print("all fixtures passed")
