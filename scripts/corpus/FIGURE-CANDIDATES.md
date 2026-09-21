# Figure candidates (C2)

Which positioned exercises are geometrically plausible owners of each secured
figure crop. Geometry only: captions, "Document 2" and "la figure ci-dessus" are
C3's evidence and are not read here, so C3 can be checked against an
independent signal.

```
python scripts/corpus/figure_candidates.py              # → corpus/.mapping/figure-candidates.json
python scripts/corpus/figure_candidates.py --show <sha> # one PDF's occurrences
python scripts/corpus/test_figure_candidates.py         # golden cases
python scripts/corpus/compare_figure_candidates.py <tsv> # existing contentImages vs candidates
```

Inputs: the C1 artifact (`corpus/.mapping/positioned-structure.json`), the
secured crops (`corpus/text/<sha>/figures/`), the Mathpix lines
(`corpus/meta/<sha>/lines.json`) and `corpus/exams.json` (for its page split
only). Output is deterministic and not committed. Nothing is written to the
database or to `contentImages`.

## Occurrences

One per crop file. A crop is tied back to its Mathpix URL by
`sha256(url)[:16]`, the name `fetch-mathpix-figures.ts` gave it; the URL
carries the page and the box (`top_left_x/y`, `width`, `height`) in the same
pixel space as the positioned lines. Content duplicates stay separate
occurrences and are cross-referenced in `sameContentAs`. The key is
`<pdf sha256[:12]>/<crop name>`; a container is `<pdf sha256[:12]>#<ordinal>`.

## Eligibility

| Class | Rule |
|---|---|
| NO_POSITION_SOURCE | the PDF is not in C1 (textbooks, exam PDFs outside the canonical extraction) |
| NON_ACADEMIC_CANDIDATE | the exam header banner: page 1, above the first exercise, top 20% of the page, ≥ 60% of page width, ≤ 7% of page height |
| POSITION_UNCERTAIN | every candidate rests on AMBIGUOUS or UNRESOLVED C1 structure, or the paper has no trusted structure at all |
| ELIGIBLE | everything else |

## Relations

Territory per page comes from C1: statement spans, lead-in spans, trailing
spans (with the reason the statement ended). Only y values from the same page
are ever compared; across a page break the relation is reading order.

- At least half the figure's height (`MAJORITY` 0.5) inside one territory:
  - statement → `INSIDE`, or `CONTINUATION_PAGE` on a page after the
    container's first. A figure that starts above that segment records
    `startsAboveSegmentBy`, since that's the gs/2011 1/math_fr.pdf shape.
  - lead-in → `LEAD_IN`.
  - trailing → no statement candidate. For an unclaimed region, the
    unplaced containers it may belong to are listed as `UNPLACED_BETWEEN`,
    or the evidence says no canonical container exists for it.
- Otherwise the figure is in a gap, and the nearest territory above and below
  (on this page, or across the break by reading order) are both kept:
  - the neighbour above → `BELOW_NEAR`;
  - the neighbour below → `ABOVE_NEAR`, or `CONTINUATION_PAGE` if it
    continues an exercise begun earlier;
  - near means a gap ≤ 10% of the page height (`NEAR_FRACTION`), or for
    the adjacent page the distance to the page edge. Measured same-page gaps
    have median 1.8% and p90 5.2% of the page, with a break before 20%.
    Beyond that the relation is `SAME_PAGE_DISTANT` / `DISTANT`;
  - unplaced containers between the two neighbours are added as
    `UNPLACED_BETWEEN`.

Every candidate carries its C1 `structuralConfidence` (EXACT / STRONG /
AMBIGUOUS / UNRESOLVED) next to its relation and measured evidence.

## Geometric confidence

A separate field, a separate vocabulary.

| geometricConfidence | Rule |
|---|---|
| UNIQUE_GEOMETRIC | one candidate; relation INSIDE, CONTINUATION_PAGE or LEAD_IN; C1 EXACT or STRONG; not Arabic Geography; the extraction's page split does not contradict it |
| MULTIPLE_GEOMETRIC | two or more candidates |
| WEAK_GEOMETRIC | one candidate that is outside its span, on untrusted structure, in Arabic Geography, or contradicted by the page split |
| NO_GEOMETRIC | no candidate: marking-scheme or other-copy territory, or a region no canonical container covers |

**Page-split second opinion.** exams.json records how many pages are
statement. Where it and C1 disagree about a crop's page, neither is reliably
right (both directions occur), so the disagreement only stops UNIQUE and is
recorded in `pageSplitDisagrees`.

**Arabic Geography** is never UNIQUE. These papers print their Documents as a
block before a single question table, so geometry can't link a map to a
question; only the references in the questions can (C3).
