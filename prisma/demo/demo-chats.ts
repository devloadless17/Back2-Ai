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
 * The seeder resolves `citeQuestion` and `citeChunk` to real row ids, so the
 * citation chips on screen link to genuine rows in this database.
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

const MODEL_NOTE = 'Demonstration transcript — recorded, not generated live.';

export const DEMO_MODEL_LABEL = MODEL_NOTE;

export const DEMO_CHATS: DemoChatSession[] = [
  // ---------------------------------------------------------------------
  // 1. Correction-key tutoring, anchored to a marked attempt
  // ---------------------------------------------------------------------
  {
    title: 'Why did I lose marks on the replication question?',
    anchorQuestion: 'A fragment of DNA contains 3 000 nucleotides',
    anchorAttempt: true,
    daysAgo: 2,
    turns: [
      {
        role: 'user',
        content: 'I got 4 out of 6 on this. I thought part 2 was right — why did I lose the marks?',
      },
      {
        role: 'assistant',
        tier: 'exact_match',
        topSimilarity: 1,
        citeQuestion: 'A fragment of DNA contains 3 000 nucleotides',
        content:
          'Your part 1 is completely right, and worth saying so: you used A = T and G = C, got T = 900, then split the remaining 1 200 evenly to reach C = 600. That is all three marks, and the method is exactly the one the marking scheme wants.\n\nPart 2 is where the two marks went. You wrote:\n\n> "After 2 replications we get 4 molecules. All 4 contain ¹⁵N because the original was ¹⁵N."\n\nThe count of 4 is right — that earned you the first mark. The second claim is where it breaks, and it is worth being precise about why.\n\nReplication is **semi-conservative**: each new molecule keeps one parental strand and builds one new one. Follow the strands rather than the molecules:\n\n- Start: 1 molecule, 2 strands, both ¹⁵N.\n- After round 1: 2 molecules. Each takes one ¹⁵N strand and builds a new ¹⁴N strand. So 2 hybrid molecules.\n- After round 2: those 2 hybrids separate into 4 strands — 2 old (¹⁵N) and 2 new (¹⁴N). Each templates a fresh ¹⁴N strand, giving 4 molecules: **2 hybrid, 2 entirely ¹⁴N**.\n\nThere were only ever 2 ¹⁵N strands. Nothing in the cell can duplicate them, so at most 2 molecules can contain one. That is the marking scheme\'s point: "concludes that 2 molecules contain a ¹⁵N strand, **with justification**" — the justification being that the parental strands are conserved and never multiply.\n\nA reliable habit for these: count *strands*, not molecules. The number of labelled strands is fixed at the start; only the total number of strands grows.',
      },
      {
        role: 'user',
        content: 'That makes sense. Would I still get a mark if I said 2 but did not explain?',
      },
      {
        role: 'assistant',
        tier: 'exact_match',
        topSimilarity: 1,
        citeQuestion: 'A fragment of DNA contains 3 000 nucleotides',
        content:
          'You would get one of the two, not both. This criterion is written as "concludes that 2 molecules contain a ¹⁵N strand, with justification" and carries 2 marks — the number alone is worth roughly half.\n\nThat pattern is worth internalising for the whole paper: where a criterion says "with justification", "explain" or "deduce", a bare answer is a half-answer. Two lines are enough here — name the semi-conservative mechanism, and say the parental strands are conserved and cannot multiply.',
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
        topSimilarity: 0.81,
        citeChunk: 'Primary and secondary responses',
        content:
          'It is the same hormone — what changes is its concentration and how long that concentration is held. The pituitary does not respond to "oestradiol" as a yes/no signal; it responds to a dose over time.\n\nThrough most of the follicular phase, oestradiol is low to moderate. At that level it **inhibits** the hypothalamus and pituitary, keeping FSH and LH down. This is the classic negative loop: more oestradiol, less stimulation, so the ovary is not over-driven.\n\nTowards the end of the follicular phase the dominant follicle is large and secretes far more oestradiol. Once it passes a threshold **and stays above it for roughly 36 hours**, the pituitary\'s response inverts: the same hormone now provokes a massive discharge of LH. That is the LH peak, and it triggers ovulation about 36 hours later.\n\nThe part students usually miss in an answer is the duration. A brief spike does not do it — the threshold has to be sustained. If you write "when oestradiol is high the feedback becomes positive" you will usually be given the mark; if you write "when oestradiol exceeds a threshold **and is maintained**, the feedback becomes positive", you have written the marking scheme\'s sentence.',
      },
    ],
  },

  // ---------------------------------------------------------------------
  // 3. Exact match on a past question
  // ---------------------------------------------------------------------
  {
    title: 'Help with the auxiliary sequence method',
    daysAgo: 8,
    turns: [
      {
        role: 'user',
        content: 'How do I show that v_n = u_n - 6 is geometric? I never know where to start.',
      },
      {
        role: 'assistant',
        tier: 'exact_match',
        topSimilarity: 0.93,
        citeQuestion: 'Let (u_n) be defined by u_0 = 5',
        content:
          'There is one move, and it is always the same move: **write v_{n+1} and substitute the recurrence.** Never start from v_n.\n\nFor u_{n+1} = 0.5·u_n + 3 with v_n = u_n − 6:\n\n1. Start from the thing you want: v_{n+1} = u_{n+1} − 6.\n2. Substitute what you know: = (0.5·u_n + 3) − 6 = 0.5·u_n − 3.\n3. Factor out the ratio so that v_n appears: 0.5·u_n − 3 = 0.5(u_n − 6) = 0.5·v_n.\n\nSo v_{n+1} = 0.5·v_n, which is the definition of geometric with ratio q = 0.5. Then v_0 = u_0 − 6 = 5 − 6 = −1.\n\nStep 3 is the one that goes wrong. Check it by expanding back: 0.5(u_n − 6) = 0.5u_n − 3. ✓\n\nAnd where does the 6 come from, if you are ever asked to find it yourself? It is the fixed point — solve L = 0.5L + 3, giving L = 6. That is the value the sequence converges to, which is also the answer to part 3.',
      },
      {
        role: 'user',
        content: 'So for u_{n+1} = 3u_n - 4 I would subtract 2?',
      },
      {
        role: 'assistant',
        tier: 'concept_level',
        topSimilarity: 0.77,
        citeChunk: 'Showing an auxiliary sequence is geometric',
        content:
          'Yes. Solve L = 3L − 4, which gives 4 = 2L, so L = 2. Set v_n = u_n − 2 and check:\n\nv_{n+1} = u_{n+1} − 2 = 3u_n − 4 − 2 = 3u_n − 6 = 3(u_n − 2) = 3·v_n. ✓\n\nRatio 3. Note this one **diverges** — |q| = 3 > 1 — so if the question asks for a limit, the answer is ±∞ depending on the sign of v_0, not a finite value. Worth checking the sign of v_0 before you write the conclusion.',
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
        topSimilarity: 0.41,
        content:
          "This isn't covered by the material available for your track, so I won't guess at it. Try rephrasing your question, or ask your teacher.\n\nWhat your programme does cover, under Genetic engineering, is restriction enzymes, DNA ligase, plasmids as vectors, and why complementary DNA from mature mRNA is used rather than genomic DNA. If you were heading towards a question about how a gene is inserted into a bacterium, ask me that and I can work through it with you.",
      },
      {
        role: 'user',
        content: 'Fair enough. Could it come up in the exam?',
      },
      {
        role: 'assistant',
        tier: 'concept_level',
        topSimilarity: 0.74,
        citeChunk: 'Properties of the genetic code',
        content:
          'I can only speak to what is in the material I have for your track, and prime editing is not in it — so I cannot tell you it will not appear, only that nothing in your programme covers it. Your teacher is the right person for that question.\n\nWhat I can tell you is what the Genetic engineering chapter does expect you to be able to do: name the enzymes that cut and join DNA, explain the role of the plasmid as a vector, and justify the use of cDNA obtained from mature mRNA — the reason being that bacteria cannot splice out introns. That last point is the one that carries marks most often, because it is the one that requires an explanation rather than a name.',
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
          'The substitution is right — u = x² is exactly the one to pick, because the derivative 2x is sitting there in front of the exponential. There are two places this normally goes wrong, and both are arithmetic rather than conceptual.\n\n**The factor of a half.** From u = x² you get du = 2x·dx, so x·dx = du/2. If you write x·dx = du you are out by a factor of 2, and the answer comes out as (e − 1) instead of ½(e − 1).\n\n**The limits.** For a definite integral the limits belong to the *new* variable. x runs 0 → 1, so u = x² runs 0 → 1 as well. Here they happen to be the same numbers, which hides the mistake — try the same integral from 0 to 2 and the limits become 0 to 4, and forgetting to convert them gives a badly wrong answer.\n\nPut together: I = ∫₀¹ e^u·(du/2) = ½[e^u]₀¹ = ½(e − 1) ≈ 0.859.\n\nCheck which of the two you did, and if it was the half, that is a one-line fix rather than a misunderstanding.',
      },
    ],
  },
];
