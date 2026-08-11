/**
 * Pre-recorded tutoring conversations for the demo.
 *
 * These are transcripts, not live generation. A demo has to work on a laptop in
 * a meeting room with no API key and no internet, and it has to show the same
 * thing every time — a live model that refuses, rambles or takes twenty seconds
 * is not a demo, it is a risk.
 *
 * What matters is that every transcript is *shaped* exactly like real output,
 * because the shape is the product:
 *
 *   * Each assistant turn carries the retrieval tier that produced it, the
 *     similarity that triggered it, and the sources it cited. Those are stored
 *     columns, not decoration — the same ones a live answer writes.
 *   * One conversation ends in a refusal. That is deliberate and it is the most
 *     important slide in the deck: the system says "this is not in your
 *     programme, I will not guess" rather than inventing a confident answer for
 *     an exam candidate. Any competitor demo can show a chatbot answering; very
 *     few can show one declining.
 *   * One conversation is anchored to the student's own marked attempt, so the
 *     tutor works from what they actually wrote and the marks they actually
 *     lost, criterion by criterion.
 *
 * Every `citeQuestion` and `citeChunk` below resolves to a real row, filed
 * under a real chapter of the Lebanese Life Sciences programme. The seeder
 * fails rather than skipping if one stops matching.
 */

export type DemoChatTurn = {
  role: 'user' | 'assistant';
  content: string;
  /** Assistant turns only. Mirrors the live pipeline's tiers. */
  tier?: 'exact_match' | 'concept_level' | 'personal_reference' | 'ungrounded_refused';
  topSimilarity?: number;
  /** Prefix of a question's contentText, resolved to its id by the seeder. */
  citeQuestion?: string;
  /** Title of a content chunk, resolved to its id by the seeder. */
  citeChunk?: string;
};

export type DemoChatSession = {
  title: string;
  /** Prefix of the question this conversation is anchored to, if any. */
  anchorQuestion?: string;
  /**
   * Anchor to the student's own attempt at `anchorQuestion`, which puts their
   * working and its marks in front of the tutor.
   */
  anchorAttempt?: boolean;
  daysAgo: number;
  turns: DemoChatTurn[];
};

export const DEMO_MODEL_LABEL = 'Demonstration transcript — recorded, not generated live.';

export const DEMO_CHATS: DemoChatSession[] = [
  // ---------------------------------------------------------------------
  // 1. Correction-key tutoring, anchored to a marked attempt
  // ---------------------------------------------------------------------
  {
    title: 'Why did I lose marks on the test cross?',
    anchorQuestion: 'A test cross between a doubly heterozygous fruit fly',
    anchorAttempt: true,
    daysAgo: 2,
    turns: [
      {
        role: 'user',
        content: 'I got 4 out of 6 on this. I said the genes were linked and I got the distance right — what did I lose?',
      },
      {
        role: 'assistant',
        tier: 'exact_match',
        topSimilarity: 1,
        citeQuestion: 'A test cross between a doubly heterozygous fruit fly',
        content:
          'Your conclusion and your distance are both right, and that is most of the paper. What you lost was the *justification* in part 2, and it is worth seeing exactly where.\n\nYou wrote:\n\n> "The genes are linked because there are more parental types than recombinants. Distance = 20 cM."\n\nThe marking scheme splits part 2 into two marks: computing the recombinant percentage, and concluding with a justification. You gave the conclusion without the arithmetic that supports it, so you took one of the two.\n\nThe examiner wants the numbers on the page:\n\n- Total = 412 + 388 + 96 + 104 = 1 000\n- Parental = 800 → 80%\n- Recombinant = 200 → 20%\n\n*Then* the sentence: if the two genes were independent, the four classes would each be about 25% — 250 each. They are not; two classes are far larger. Therefore the genes are linked.\n\nThe comparison against 25% is the actual argument. "More parentals than recombinants" describes the data; it does not say what you are comparing it to.\n\nOne thing you did well and should keep doing: you wrote the total out before taking percentages. Most students divide by the wrong denominator here.',
      },
      {
        role: 'user',
        content: 'So the distance is just the recombinant percentage? Always?',
      },
      {
        role: 'assistant',
        tier: 'exact_match',
        topSimilarity: 0.94,
        citeQuestion: 'A test cross between a doubly heterozygous fruit fly',
        content:
          'For the distances you meet at this level, yes: 1% recombinants = 1 centimorgan, so 20% = 20 cM.\n\nThe one caution to keep in the back of your mind is that this only holds while the two loci are close. When they are far apart, double crossovers put a chromatid back to the parental arrangement, so the recombinants you count *under*-estimate the true distance, and the measured value saturates near 50%.\n\nAt 20% you are comfortably inside the range where the direct reading is the expected answer. If you ever compute something at or above 50%, that is the signal the genes are behaving as independent rather than that they are extremely far apart.',
      },
    ],
  },

  // ---------------------------------------------------------------------
  // 2. Concept-level grounding in course material
  // ---------------------------------------------------------------------
  {
    title: 'Why does oestradiol feedback reverse?',
    daysAgo: 5,
    turns: [
      {
        role: 'user',
        content:
          'I do not understand how oestradiol can be negative feedback and then positive feedback. Is it not the same hormone?',
      },
      {
        role: 'assistant',
        tier: 'concept_level',
        topSimilarity: 0.88,
        citeChunk: 'Negative and positive feedback across the cycle',
        content:
          'It is the same hormone — what changes is its concentration and how long that concentration is held. The pituitary does not respond to "oestradiol" as a yes/no signal; it responds to a dose over time.\n\nThrough most of the follicular phase, oestradiol is low to moderate. At that level it **inhibits** the hypothalamus and the pituitary, keeping FSH and LH down. That is the classic negative loop: more oestradiol, less stimulation, so the ovary is not over-driven.\n\nTowards the end of the follicular phase the dominant follicle is large and secretes far more oestradiol. Once it passes a threshold **and stays above it for roughly 36 hours**, the pituitary\'s response inverts: the same hormone now provokes a massive discharge of LH. That is the LH peak, and ovulation follows about 36 hours later.\n\nThe part students usually drop is the duration. A brief spike does not do it — the threshold has to be sustained. Write "when oestradiol exceeds a threshold **and is maintained**, the feedback becomes positive" and you have written the marking scheme\'s sentence.',
      },
    ],
  },

  // ---------------------------------------------------------------------
  // 3. Exact match on a past question
  // ---------------------------------------------------------------------
  {
    title: 'Studying the sign of a derivative with eˣ',
    daysAgo: 8,
    turns: [
      {
        role: 'user',
        content: 'For f(x) = (x-1)e^x I get f\'(x) = x e^x but then I do not know how to study the sign.',
      },
      {
        role: 'assistant',
        tier: 'exact_match',
        topSimilarity: 0.95,
        citeQuestion: 'Consider f(x) = (x − 1)·e^x on',
        content:
          'Your derivative is right, and the sign study is shorter than you think — because one of the two factors can never be negative.\n\nf′(x) = x·e^x is a product of x and e^x. The exponential is **strictly positive for every real x**, with no exceptions. So the sign of the product is entirely the sign of x:\n\n- x < 0 → f′(x) < 0 → f is decreasing\n- x = 0 → f′(0) = 0\n- x > 0 → f′(x) > 0 → f is increasing\n\nThat is the whole argument, and writing the sentence "since e^x > 0 for all x, f′ has the sign of x" is what earns the mark. A sign table with two rows — one for x, one for e^x — makes it visible at a glance.\n\nThe minimum then sits at x = 0, with f(0) = (0 − 1)·e⁰ = −1. That point matters for part 3: the curve comes down to −1 and climbs from there, which is why the equation f(x) = 0 can have only one root.',
      },
      {
        role: 'user',
        content: 'And the limit at minus infinity? I get infinity times zero.',
      },
      {
        role: 'assistant',
        tier: 'concept_level',
        topSimilarity: 0.79,
        citeChunk: 'Derivative of a product involving eˣ',
        content:
          'You have spotted the indeterminate form correctly — (−∞) × 0 is not something you can evaluate as it stands. It is resolved by a growth comparison rather than by algebra.\n\nAs x → −∞, e^x tends to 0 *faster* than (x − 1) tends to −∞. The exponential wins, so the product tends to 0. And since (x − 1) is negative there while e^x is positive, the product approaches 0 **from below** — which is why the table of variations shows 0⁻ rather than 0.\n\nThat detail is worth the ink: it tells you the curve stays under the x-axis on the whole left branch, which is exactly the argument you need for "no root on (−∞, 0]" in part 3.\n\nAt +∞ there is no indeterminacy at all: both factors go to +∞, so f(x) → +∞.',
      },
    ],
  },

  // ---------------------------------------------------------------------
  // 4. The refusal — the most important transcript here
  // ---------------------------------------------------------------------
  {
    title: 'CRISPR prime editing',
    daysAgo: 11,
    turns: [
      {
        role: 'user',
        content:
          'Can you explain how CRISPR prime editing works, with the reverse transcriptase step? My cousin at university mentioned it.',
      },
      {
        role: 'assistant',
        tier: 'ungrounded_refused',
        topSimilarity: 0.39,
        content:
          "This isn't covered by the material available for your track, so I won't guess at it. Try rephrasing your question, or ask your teacher.\n\nWhat your programme does cover, under Reproduction and Genetics, is the transmission of genes, crossing over and genetic recombination, genetic variation and polymorphism, and human genetics — pedigrees and the reasoning that goes with them. If you were heading towards a question about how variation arises, ask me that and I can work through it with you.",
      },
      {
        role: 'user',
        content: 'Fair enough. Could it come up in the exam?',
      },
      {
        role: 'assistant',
        tier: 'concept_level',
        topSimilarity: 0.72,
        citeChunk: 'Reading a test cross',
        content:
          'I can only speak to the material I have for your track, and prime editing is not in it — so I cannot tell you it will not appear, only that nothing in your programme covers it. Your teacher is the right person for that.\n\nWhat I can tell you is what the genetics chapters do expect you to be able to do: read a pedigree and argue dominance and linkage from it, interpret a test cross, and compute a distance in centimorgans from a recombinant percentage. That last one carries marks most often, because it needs a calculation *and* a justification rather than a recalled fact.',
      },
    ],
  },

  // ---------------------------------------------------------------------
  // 5. Method help, concept-level
  // ---------------------------------------------------------------------
  {
    title: 'Substitution in a definite integral',
    daysAgo: 14,
    turns: [
      {
        role: 'user',
        content: 'For the integral of x·e^(x²) I set u = x² but then I got a different answer to the book. Where did I go wrong?',
      },
      {
        role: 'assistant',
        tier: 'concept_level',
        topSimilarity: 0.86,
        citeChunk: 'Integration by substitution',
        content:
          'The substitution is right — u = x² is exactly the one to pick, because the derivative 2x is sitting there in front of the exponential. There are two places this normally goes wrong, and both are arithmetic rather than conceptual.\n\n**The factor of a half.** From u = x² you get du = 2x·dx, so x·dx = du/2. If you write x·dx = du you are out by a factor of 2, and the answer comes out as (e − 1) instead of ½(e − 1).\n\n**The limits.** For a definite integral the limits belong to the *new* variable. Here x runs 0 → 1, so u = x² runs 0 → 1 as well. They happen to be the same numbers, which hides the mistake — try the same integral from 0 to 2 and the limits become 0 to 4, and forgetting to convert gives a badly wrong answer.\n\nPut together: I = ∫₀¹ e^u·(du/2) = ½[e^u]₀¹ = ½(e − 1) ≈ 0.859.\n\nCheck which of the two you did. If it was the half, that is a one-line fix rather than a misunderstanding.',
      },
    ],
  },
];
