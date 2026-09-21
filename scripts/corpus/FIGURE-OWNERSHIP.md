# Figure ownership (C3)

Which academic object uses each figure crop, and at what level. Deterministic;
no model is asked anything; nothing is written to the database or to
`contentImages`.

```
python scripts/corpus/figure_ownership.py               # → corpus/.mapping/figure-ownership.json
python scripts/corpus/figure_ownership.py --show <sha>  # one PDF
python scripts/corpus/test_figure_ownership.py          # fixtures
python scripts/corpus/audit_legacy_figures.py <tsv>     # existing contentImages vs C3, read-only
```

Inputs: the C2 artifact (which carries C1's confidence), the Mathpix lines (for
captions) and `corpus/exams.json` (for the questions). The output references
C1/C2 by occurrence and container ids rather than copying their evidence.

## Three separate confidences

| Field | Layer | Says |
|---|---|---|
| `structuralConfidence` | C1 | where the exercise is printed |
| `geometricConfidence` | C2 | which exercises the crop could belong to |
| `semanticConfidence` | C3 | who uses the crop |

A UNIQUE geometric candidate only says one exercise is plausible. It never
says which of the exercise's questions use the crop.

## Identity is not ownership

`visualIdentity` is what a caption says the crop **is**: `{kind: document |
figure, number, suffix, source}`. It's read from the crop's own figure block
(`\caption{Document 2}`), else the line just below, else the line just above
if no other crop claimed that line. Forms were taken from the corpus: "Document
#", "Doc. #", "Document-#", "Fig. #", "Figure #", "المستند رقم (#)".

**Arabic numerals.** Mathpix reads Arabic-Indic digits as Latin look-alikes.
Only unambiguous readings are accepted (`l` = ١, `ε` = ٤). `r` is both ٢ and ٣
and is never guessed; it's kept as `numberRaw`.

`references` are who **uses** it: numbered mentions in the canonical questions,
with lists and ranges expanded ("documents 1 et 2", "1 to 3", "المستندين رقم
(1) ورقم (3)"). Ownership is only claimed where identity and reference meet.

Two properties of the canonical text are handled explicitly:

- **Caption echo.** The text layer contains the printed captions. A mention
  that opens a short line (≤ 10 words) is the caption printed again, not a
  reference to it.
- **Stimulus riding on a question.** The extractor appends the text between
  questions to the previous part: "3. Que peut-on en conclure ? Expérience 2 :
  …". A part is split into its own question (up to its first "?", else its
  first sentence after its label) and trailing stimulus.

## Semantic confidence

| Value | Rule |
|---|---|
| DIRECT_REFERENCE | the crop's caption number is named by exactly one candidate exercise (Arabic Geography: by the paper) |
| CORROBORATED | several candidates name it and geometry picks one of them; or no caption, one geometric candidate, and that exercise refers to an unnumbered visual ("figure ci-contre", "the adjacent curve (C)", "circuit") |
| CONTEXTUAL | one geometric candidate and no textual support; or, between two exercises, only one neighbour uses pointing language toward it: forward ("ci-après", "below") at the end of the exercise above, backward ("ci-dessus", "above") at the start of the one below, "ci-contre"/"adjacent" either side |
| AMBIGUOUS | competing owners remain, or one caption is claimed by crops pages apart inside one owner (identity conflict) |
| UNRESOLVED | not enough evidence |

A visual noun anywhere in a neighbour's text is not evidence for a figure
between two exercises. In ls/2015 1/chem_fr.pdf, exercise 2 mentions "courbe
(C)", but the three curves opening page 2 belong to exercise 1 ("trois courbes
données ci-après").

## Ownership level

Level follows who **consumes** the visual, meaning which questions' own text
names it. Where it's introduced is recorded separately
(`introducedInStimulus`).

| Level | Meaning |
|---|---|
| SUBQUESTION / QUESTION | exactly one question's own text names it |
| EXERCISE_SHARED | two or more questions name it |
| EXERCISE_CONTEXT | only the stimulus names it |
| EXERCISE | owned by the exercise on geometry and context; no question tied to it |
| PAPER_SHARED | Arabic Geography: named by several containers of the paper |
| SOLUTION_MATERIAL | marking-scheme territory (C2): official-solution evidence, never question evidence |
| EXCLUDED | exam header banner |
| UNRESOLVED | — |

## Outside C3's scope

C2's NONE, position-uncertain, no-position-source and non-academic crops keep
their class. A NONE crop whose caption a statement names is flagged
`c2Contradiction` for review and never promoted.

## Known limits

- Captions come from Mathpix and can be wrong. gs/2015 1/phy_en.pdf has a crop
  showing "Fig.3" captioned `Fig. 1`.
- A canonical container built from scheme text (ls/2006 1/bio_en.pdf,
  containers 5–10) can own a scheme figure on geometry alone.
- Arabic Geography is mostly unresolved. 198 of its 254 crops carry no caption,
  so the clean references in its questions have nothing to meet.
