<!-- Table of contents, transcribed from the book's own printed contents page.

The English edition of the GS/LS chemistry book. Its French twin
(chimie-fr__0ddf683b) has had an override since the beginning and parses
correctly; this one never did, and the automatic parse failed in the way that
does not announce itself.

What that cost, measured before this file existed:

  "pH. Strong acid, strong base"   located on no page at all   0 passages, 13 questions
  "Alcohols"                        given pages 200-202         2 passages, 17 questions

against 45 and 46 passages for the same two chapters in the French edition. A
chapter with no passages cannot be retrieved by any query ever asked, so 30 of
103 GS Chemistry past-exam questions sat under material the tutor could not
reach — and the tutor answered them anyway, from the nearest chapter it could
find, fluently, with a citation. GS Chemistry scored 0.37 lift against the
French edition's 0.74 and four separate theories were tested and discarded
before anyone asked whether the chapters had any text behind them.

The numbers are the PRINTED pages, as in the contents page. They are NOT the
French edition's: this book sets Part 3 at 77 where the French sets 79, and
Parts 7 to 9 at 320/342/370 against 321/343/371. Copying the twin would have
been wrong by a page or two everywhere, which is exactly enough to lose a
chapter's opening.

STILL WRONG, and left wrong deliberately: chapter 9 Alcohols. The locator
searches the text for each chapter title, and "alcohols" and "aldehydes and
ketones" are ordinary words in a chemistry book — it matched "the carbonyl group
-CO- characterizes the aldehydes and ketones" in prose on PDF page 202 and
concluded the Alcohols chapter ended there. Three pages instead of twenty-six,
and 17 questions filed against them.

Pinning those three chapters with their own dot-leader pages was tried and
reverted: a page number on a chapter line makes the parser read ONLY the pinned
lines as chapters, and the book dropped from 16 chapters to 3 with Aldehydes
running to the end of the volume. Fixing this properly means teaching the
locator to prefer a heading over a mention — `\section*{ALCOHOLS}` sits on PDF
page 206 — not annotating it here.

Chapters 12, 14, 15 and 16 carry an asterisk in the contents page. Per the
foreword, those are NOT in the General Sciences programme — only in Life
Sciences. This book serves both sections, so the distinction matters when the
chapters are filed.
-->

Part 1 The Gaseous State ..... 11
1 The Gaseous State

Part 2 Chemical Kinetics ..... 26
2 Rate of Reactions
3 Kinetic Factors

Part 3 Chemical Equilibrium ..... 77
4 Chemical Equilibrium

Part 4 Acid-base reactions in aqueous solution. The pH scale. ..... 108
5 pH. Strong acid, strong base. pH-metric titration
6 Weak acid, weak base, conjugate acid/base pair
7 Reaction between a weak acid and a strong base

Part 5 Organic Chemistry II ..... 193
8 Functional Groups
9 Alcohols
10 Aldehydes and Ketones
11 Carboxylic acids and their derivatives
12 Amines and α-amino acids

Part 6 Polymers ..... 301
13 Polymers

Part 7 Soaps and detergents ..... 320
14 Soaps and detergents

Part 8 Current Medicinal Drugs ..... 342
15 Current Medicinal Drugs

Part 9 New Materials ..... 370
16 New Materials
