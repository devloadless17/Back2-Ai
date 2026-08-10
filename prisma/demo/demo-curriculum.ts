/**
 * DEMONSTRATION CONTENT — NOT OFFICIAL MINISTRY MATERIAL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Read this before showing the demo to anyone.
 *
 * Everything in this file was written for this repository. The taxonomy follows
 * the shape of the Lebanese Baccalaureate Life Sciences (LS / SV) programme as
 * taught in English-section schools, and the questions are written in the style
 * and at the level of that programme — but they are NOT transcriptions of real
 * past papers, and the exam cycles below are illustrative rather than authentic.
 *
 * That distinction matters commercially as well as ethically. Presenting
 * invented questions to a prospective customer as genuine ministry papers is a
 * misrepresentation, and copying real papers verbatim is someone else's
 * copyright. The demo is therefore explicit about what it is: every cycle title
 * carries "(illustrative)", and the demo account opens with an announcement
 * saying so on the dashboard.
 *
 * The real corpus is loaded through scripts/ingest.ts into these same tables.
 * When it arrives, this file is deleted and nothing else changes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const DEMO_TRACK_CODE = 'LS';
export const DEMO_TRACK_NAME = 'Life Sciences — English section';

/** Shown on the dashboard so nobody mistakes the demo for the real corpus. */
export const DEMO_NOTICE_TITLE = 'Demonstration account';
export const DEMO_NOTICE_BODY =
  'This account is loaded with illustrative content written to show how the system works. ' +
  'The questions, solutions and marking schemes are realistic for the Lebanese LS programme ' +
  'but are not official ministry papers. Real papers are loaded through the ingestion pipeline.';

export type DemoChapter = { name: string; unit: string };

export type DemoSubject = {
  name: string;
  language: 'fr' | 'en' | 'ar';
  units: string[];
  chapters: DemoChapter[];
};

export const DEMO_SUBJECTS: DemoSubject[] = [
  {
    name: 'Life Sciences',
    language: 'en',
    units: ['Genetics', 'Immunology', 'Neurophysiology', 'Reproduction'],
    chapters: [
      { name: 'DNA replication', unit: 'Genetics' },
      { name: 'Transcription and translation', unit: 'Genetics' },
      { name: 'Mutations and variability', unit: 'Genetics' },
      { name: 'Genetic engineering', unit: 'Genetics' },
      { name: 'Innate immunity', unit: 'Immunology' },
      { name: 'Adaptive immunity', unit: 'Immunology' },
      { name: 'Vaccination and immune memory', unit: 'Immunology' },
      { name: 'The nerve message', unit: 'Neurophysiology' },
      { name: 'The synapse', unit: 'Neurophysiology' },
      { name: 'Hormonal regulation', unit: 'Reproduction' },
    ],
  },
  {
    name: 'Mathematics',
    language: 'en',
    units: ['Analysis', 'Probability and statistics'],
    chapters: [
      { name: 'Numerical sequences', unit: 'Analysis' },
      { name: 'Study of functions', unit: 'Analysis' },
      { name: 'The exponential function', unit: 'Analysis' },
      { name: 'Integral calculus', unit: 'Analysis' },
      { name: 'Conditional probability', unit: 'Probability and statistics' },
      { name: 'Probability distributions', unit: 'Probability and statistics' },
    ],
  },
  {
    name: 'Chemistry',
    language: 'en',
    units: ['Kinetics and equilibrium', 'Organic chemistry'],
    chapters: [
      { name: 'Rate of reaction', unit: 'Kinetics and equilibrium' },
      { name: 'Chemical equilibrium', unit: 'Kinetics and equilibrium' },
      { name: 'Acids and bases', unit: 'Kinetics and equilibrium' },
      { name: 'Esterification and hydrolysis', unit: 'Organic chemistry' },
      { name: 'Organic functional groups', unit: 'Organic chemistry' },
    ],
  },
  {
    name: 'Physics',
    language: 'en',
    units: ['Mechanics', 'Electricity and nuclear'],
    chapters: [
      { name: 'Newton’s laws', unit: 'Mechanics' },
      { name: 'Mechanical oscillations', unit: 'Mechanics' },
      { name: 'Electromagnetic induction', unit: 'Electricity and nuclear' },
      { name: 'Radioactivity', unit: 'Electricity and nuclear' },
    ],
  },
];

export type DemoExamCycle = {
  subject: string;
  year: number;
  session: string;
  title: string;
  durationMinutes: number;
};

/**
 * Illustrative cycles across five years.
 *
 * Durations match the real programme (Life Sciences and Mathematics sit for
 * three hours in the LS stream, the sciences for two), because a demo of an
 * exam simulator that runs for the wrong length is a demo of the wrong product.
 */
export const DEMO_EXAM_CYCLES: DemoExamCycle[] = [
  { subject: 'Life Sciences', year: 2023, session: 'session1', title: 'Life Sciences 2023 — Session 1 (illustrative)', durationMinutes: 180 },
  { subject: 'Life Sciences', year: 2023, session: 'session2', title: 'Life Sciences 2023 — Session 2 (illustrative)', durationMinutes: 180 },
  { subject: 'Life Sciences', year: 2022, session: 'session1', title: 'Life Sciences 2022 — Session 1 (illustrative)', durationMinutes: 180 },
  { subject: 'Life Sciences', year: 2021, session: 'session1', title: 'Life Sciences 2021 — Session 1 (illustrative)', durationMinutes: 180 },
  { subject: 'Mathematics', year: 2023, session: 'session1', title: 'Mathematics 2023 — Session 1 (illustrative)', durationMinutes: 180 },
  { subject: 'Mathematics', year: 2022, session: 'session1', title: 'Mathematics 2022 — Session 1 (illustrative)', durationMinutes: 180 },
  { subject: 'Chemistry', year: 2023, session: 'session1', title: 'Chemistry 2023 — Session 1 (illustrative)', durationMinutes: 120 },
  { subject: 'Physics', year: 2023, session: 'session1', title: 'Physics 2023 — Session 1 (illustrative)', durationMinutes: 120 },
];

export type DemoQuestion = {
  chapter: string;
  subject: string;
  questionType: 'mcq' | 'open' | 'problem';
  /** 0..1. Drives ordering in practice and the difficulty label. */
  difficulty: number;
  contentText: string;
  contentLatex?: string;
  options?: { id: string; text: string }[];
  correctOptionId?: string;
  officialSolution?: string;
  bareme?: { criterion: string; points: number }[];
  cycle?: { year: number; session: string; orderIndex: number };
};

/**
 * The question bank.
 *
 * Weighted towards barème-marked open questions rather than MCQ, because the
 * marking engine is the part of the product worth demonstrating: anybody can
 * check a radio button against an answer key. Each barème is written the way a
 * Lebanese examiner writes one — method marks before answer marks, so a student
 * with the right approach and an arithmetic slip still scores.
 */
export const DEMO_QUESTIONS: DemoQuestion[] = [
  // ======================= LIFE SCIENCES : GENETICS =======================
  {
    chapter: 'DNA replication',
    subject: 'Life Sciences',
    questionType: 'mcq',
    difficulty: 0.25,
    contentText:
      'During DNA replication, the enzyme responsible for joining free nucleotides to the growing strand in the 5′ → 3′ direction is:',
    options: [
      { id: 'a', text: 'DNA helicase' },
      { id: 'b', text: 'DNA polymerase' },
      { id: 'c', text: 'DNA ligase' },
      { id: 'd', text: 'RNA primase' },
    ],
    correctOptionId: 'b',
    officialSolution:
      'DNA polymerase adds nucleotides to the free 3′-OH end of the growing strand, so synthesis proceeds 5′ → 3′. Helicase unwinds the double helix, ligase seals nicks between Okazaki fragments, and primase lays down the RNA primer.',
  },
  {
    chapter: 'DNA replication',
    subject: 'Life Sciences',
    questionType: 'open',
    difficulty: 0.55,
    contentText:
      'A fragment of DNA contains 3 000 nucleotides, of which 900 are adenine. This fragment undergoes two successive rounds of semi-conservative replication in a medium containing only ¹⁴N.\n\n1. Determine the number of cytosine nucleotides in the fragment.\n2. Determine the number of DNA molecules obtained after two replications, and state how many contain a ¹⁵N strand if the original molecule was fully labelled with ¹⁵N.',
    officialSolution:
      '1. In double-stranded DNA, A = T and G = C. With 3 000 nucleotides in total and 900 adenine, we have 900 thymine, so A + T = 1 800. The remaining 3 000 − 1 800 = 1 200 nucleotides are shared equally between G and C, giving C = 600.\n\n2. Replication is semi-conservative: one molecule gives 2 after the first round and 4 after the second. Each original ¹⁵N strand is conserved in one molecule, so exactly 2 of the 4 molecules contain one ¹⁵N strand and one ¹⁴N strand; the other 2 are entirely ¹⁴N.',
    bareme: [
      { criterion: 'States the complementarity rule A = T and G = C', points: 1 },
      { criterion: 'Deduces T = 900 and therefore G + C = 1 200', points: 1 },
      { criterion: 'Concludes C = 600', points: 1 },
      { criterion: 'States that replication is semi-conservative and gives 4 molecules', points: 1 },
      { criterion: 'Concludes that 2 molecules contain a ¹⁵N strand, with justification', points: 2 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 0 },
  },
  {
    chapter: 'Transcription and translation',
    subject: 'Life Sciences',
    questionType: 'open',
    difficulty: 0.5,
    contentText:
      'The transcribed (template) strand of a gene fragment reads: 3′ — T A C  G G A  C T T  A C T — 5′.\n\n1. Write the sequence of the messenger RNA produced.\n2. Using the genetic code, give the resulting peptide.\n3. Explain why the genetic code is described as redundant but not ambiguous.',
    officialSolution:
      '1. The mRNA is complementary and antiparallel to the template: 5′ — A U G  C C U  G A A  U G A — 3′.\n\n2. AUG = methionine (start), CCU = proline, GAA = glutamate, UGA = stop. The peptide is Met — Pro — Glu.\n\n3. Redundant: several codons may specify the same amino acid (for example CCU, CCC, CCA and CCG all code for proline). Not ambiguous: a given codon always specifies one and only one amino acid.',
    bareme: [
      { criterion: 'mRNA written complementary and antiparallel to the template', points: 1.5 },
      { criterion: 'Correct reading from the start codon AUG', points: 1 },
      { criterion: 'Correct peptide Met — Pro — Glu, stop codon not translated', points: 1.5 },
      { criterion: 'Redundancy explained with an example', points: 1 },
      { criterion: 'Non-ambiguity explained', points: 1 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 1 },
  },
  {
    chapter: 'Mutations and variability',
    subject: 'Life Sciences',
    questionType: 'mcq',
    difficulty: 0.35,
    contentText:
      'A substitution replaces the codon GAG with GTG in the gene coding for the β-globin chain. The consequence is:',
    options: [
      { id: 'a', text: 'A silent mutation with no effect on the protein' },
      { id: 'b', text: 'A frameshift affecting every downstream codon' },
      { id: 'c', text: 'The replacement of one amino acid, producing haemoglobin S' },
      { id: 'd', text: 'A premature stop codon, truncating the chain' },
    ],
    correctOptionId: 'c',
    officialSolution:
      'GAG codes for glutamate and GTG for valine, so a single amino acid is replaced. The chain keeps its length — this is a missense substitution, not a frameshift or a nonsense mutation — and the resulting haemoglobin S polymerises when deoxygenated, deforming the red cell.',
  },
  {
    chapter: 'Genetic engineering',
    subject: 'Life Sciences',
    questionType: 'open',
    difficulty: 0.65,
    contentText:
      'A laboratory wishes to produce human insulin using the bacterium Escherichia coli.\n\n1. Name the enzymes used to cut the plasmid and the human gene, and to join them.\n2. Explain why the gene inserted is obtained from mature messenger RNA rather than directly from genomic DNA.\n3. State one advantage of this production method over extraction from animal pancreas.',
    officialSolution:
      '1. Restriction enzymes (restriction endonucleases) cut the plasmid and the gene at specific sequences, producing complementary sticky ends; DNA ligase joins the fragments to form the recombinant plasmid.\n\n2. Bacteria have no spliceosome and cannot remove introns. Complementary DNA obtained by reverse transcription of mature mRNA contains only exons, so the bacterium can translate it into a correct protein.\n\n3. The hormone produced is human insulin exactly, so it avoids the immune reactions caused by the small sequence differences in bovine or porcine insulin; production is also scalable and does not depend on animal supply.',
    bareme: [
      { criterion: 'Names restriction enzymes for cutting', points: 1 },
      { criterion: 'Names DNA ligase for joining', points: 1 },
      { criterion: 'Explains that bacteria cannot splice introns', points: 1.5 },
      { criterion: 'Links this to the use of cDNA from mature mRNA', points: 1.5 },
      { criterion: 'Gives a valid advantage with justification', points: 1 },
    ],
  },

  // ======================= LIFE SCIENCES : IMMUNOLOGY ======================
  {
    chapter: 'Innate immunity',
    subject: 'Life Sciences',
    questionType: 'mcq',
    difficulty: 0.2,
    contentText: 'Which of the following is a characteristic of the innate immune response?',
    options: [
      { id: 'a', text: 'It is specific to the antigen encountered' },
      { id: 'b', text: 'It improves on a second encounter with the same antigen' },
      { id: 'c', text: 'It is immediate and identical whatever the intruder' },
      { id: 'd', text: 'It depends on the production of antibodies by plasma cells' },
    ],
    correctOptionId: 'c',
    officialSolution:
      'Innate immunity is immediate, non-specific and identical on every encounter. Specificity, memory and antibody production all belong to the adaptive response.',
  },
  {
    chapter: 'Adaptive immunity',
    subject: 'Life Sciences',
    questionType: 'open',
    difficulty: 0.6,
    contentText:
      'A patient is infected by a virus for the first time. Blood analysis shows a rise in specific antibodies from the tenth day, then a fall. Two years later the same patient meets the same virus and the antibody level rises within two days to a much higher value.\n\n1. Name the type of immune response involved and the cells that produce the antibodies.\n2. Explain the difference in speed and intensity between the two responses.',
    officialSolution:
      '1. This is the adaptive (acquired) humoral response. Antibodies are secreted by plasma cells, which are the effector cells produced by the differentiation of activated B lymphocytes.\n\n2. On first contact the few B lymphocytes carrying the receptor complementary to the antigen must be selected, multiply (clonal expansion) and differentiate, which takes about ten days. This primary response also produces memory B lymphocytes. On second contact these memory cells are already numerous and specific, so they differentiate into plasma cells almost immediately: the secondary response is faster, larger and longer-lasting.',
    bareme: [
      { criterion: 'Identifies the adaptive humoral response', points: 1 },
      { criterion: 'Names plasma cells as the antibody producers', points: 1 },
      { criterion: 'Explains selection, clonal expansion and differentiation in the primary response', points: 2 },
      { criterion: 'Explains the role of memory lymphocytes in the secondary response', points: 2 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 2 },
  },
  {
    chapter: 'Vaccination and immune memory',
    subject: 'Life Sciences',
    questionType: 'open',
    difficulty: 0.45,
    contentText:
      'Explain, in terms of immune memory, why a vaccine is administered before exposure to a pathogen whereas a serum is administered after. State one limitation of each.',
    officialSolution:
      'A vaccine introduces an antigen that has been made harmless. It triggers a primary adaptive response and, above all, the production of memory lymphocytes, which takes several days to weeks — hence it must be given before exposure. Its protection is long-lasting but is not immediate.\n\nA serum supplies ready-made specific antibodies. Protection is immediate, which is why it is given after exposure, but the recipient produces no memory cells, so the protection disappears as the injected antibodies are degraded.',
    bareme: [
      { criterion: 'Vaccine described as producing an active response with memory cells', points: 1.5 },
      { criterion: 'Serum described as supplying ready-made antibodies (passive)', points: 1.5 },
      { criterion: 'Limitation of the vaccine: delay before protection', points: 1 },
      { criterion: 'Limitation of the serum: no memory, short-lived protection', points: 1 },
    ],
  },

  // ==================== LIFE SCIENCES : NEUROPHYSIOLOGY ====================
  {
    chapter: 'The nerve message',
    subject: 'Life Sciences',
    questionType: 'open',
    difficulty: 0.6,
    contentText:
      'Two stimulations of increasing intensity are applied to a nerve fibre. The first, below threshold, produces no action potential. The second produces a series of action potentials of constant amplitude but increasing frequency.\n\n1. State the law illustrated by the constant amplitude.\n2. Explain how the intensity of a stimulus is coded along a single fibre.',
    officialSolution:
      '1. The all-or-none law: below the threshold no action potential is produced; at or above it the action potential always has the same amplitude, independent of stimulus intensity.\n\n2. Along one fibre, intensity is coded by frequency modulation: the stronger the stimulus, the higher the frequency of action potentials, up to a limit imposed by the refractory period. (Across a nerve, intensity is additionally coded by the number of fibres recruited.)',
    bareme: [
      { criterion: 'States the all-or-none law correctly', points: 1.5 },
      { criterion: 'Identifies frequency coding of intensity', points: 1.5 },
      { criterion: 'Mentions the limit imposed by the refractory period', points: 1 },
    ],
  },
  {
    chapter: 'The synapse',
    subject: 'Life Sciences',
    questionType: 'mcq',
    difficulty: 0.4,
    contentText: 'At a chemical synapse, the arrival of an action potential at the presynaptic ending causes:',
    options: [
      { id: 'a', text: 'The entry of Ca²⁺ ions and exocytosis of neurotransmitter' },
      { id: 'b', text: 'The direct passage of the action potential across the cleft' },
      { id: 'c', text: 'The entry of Cl⁻ ions into the presynaptic ending' },
      { id: 'd', text: 'The synthesis of new receptors on the postsynaptic membrane' },
    ],
    correctOptionId: 'a',
    officialSolution:
      'Depolarisation opens voltage-gated calcium channels; the influx of Ca²⁺ triggers the fusion of synaptic vesicles with the presynaptic membrane and the release of neurotransmitter by exocytosis. Transmission across the cleft is chemical, not electrical, which is what makes it unidirectional.',
  },
  {
    chapter: 'Hormonal regulation',
    subject: 'Life Sciences',
    questionType: 'open',
    difficulty: 0.7,
    contentText:
      'In a female, the plasma concentration of oestradiol rises during the follicular phase. Just before ovulation this rise is followed by a sharp peak of LH.\n\n1. Name the gland secreting LH and the gland secreting oestradiol.\n2. Explain the change in the feedback exerted by oestradiol over the cycle.',
    officialSolution:
      '1. LH is secreted by the anterior pituitary (adenohypophysis); oestradiol is secreted by the ovarian follicle, specifically its granulosa and theca cells.\n\n2. At low and moderate concentrations, oestradiol exerts negative feedback on the hypothalamus and pituitary, limiting FSH and LH secretion. When its concentration exceeds a threshold and is maintained for about 36 hours at the end of the follicular phase, the feedback reverses and becomes positive: the pituitary responds with a massive discharge of LH, the peak that triggers ovulation.',
    bareme: [
      { criterion: 'Identifies the anterior pituitary as the source of LH', points: 1 },
      { criterion: 'Identifies the ovarian follicle as the source of oestradiol', points: 1 },
      { criterion: 'Describes negative feedback at low concentration', points: 1.5 },
      { criterion: 'Describes the reversal to positive feedback above threshold', points: 1.5 },
      { criterion: 'Links the LH peak to ovulation', points: 1 },
    ],
    cycle: { year: 2022, session: 'session1', orderIndex: 0 },
  },

  // ========================== MATHEMATICS =================================
  {
    chapter: 'Numerical sequences',
    subject: 'Mathematics',
    questionType: 'mcq',
    difficulty: 0.3,
    contentText:
      'The sequence (u_n) is defined by u_0 = 3 and u_{n+1} = 2u_n − 1 for all n ≥ 0. What is u_3?',
    contentLatex:
      'The sequence $(u_n)$ is defined by $u_0 = 3$ and $u_{n+1} = 2u_n - 1$ for all $n \\geq 0$. What is $u_3$?',
    options: [
      { id: 'a', text: '11' },
      { id: 'b', text: '17' },
      { id: 'c', text: '15' },
      { id: 'd', text: '9' },
    ],
    correctOptionId: 'b',
    officialSolution: 'u₁ = 2(3) − 1 = 5; u₂ = 2(5) − 1 = 9; u₃ = 2(9) − 1 = 17.',
  },
  {
    chapter: 'Numerical sequences',
    subject: 'Mathematics',
    questionType: 'problem',
    difficulty: 0.65,
    contentText:
      'Let (u_n) be defined by u_0 = 5 and u_{n+1} = 0.5·u_n + 3 for all n ≥ 0. Let v_n = u_n − 6.\n\n1. Show that (v_n) is geometric; give its ratio and first term.\n2. Express v_n, then u_n, in terms of n.\n3. Determine the limit of (u_n) and interpret it.',
    contentLatex:
      'Let $(u_n)$ be defined by $u_0 = 5$ and $u_{n+1} = 0.5\\,u_n + 3$ for all $n \\geq 0$. Let $v_n = u_n - 6$.\n\n1. Show that $(v_n)$ is geometric; give its ratio and first term.\n2. Express $v_n$, then $u_n$, in terms of $n$.\n3. Determine $\\lim_{n \\to +\\infty} u_n$ and interpret it.',
    officialSolution:
      '1. v_{n+1} = u_{n+1} − 6 = 0.5u_n + 3 − 6 = 0.5u_n − 3 = 0.5(u_n − 6) = 0.5·v_n. So (v_n) is geometric with ratio q = 0.5 and first term v_0 = u_0 − 6 = −1.\n\n2. v_n = v_0·q^n = −(0.5)^n, hence u_n = v_n + 6 = 6 − (0.5)^n.\n\n3. Since 0 < 0.5 < 1, (0.5)^n → 0, so u_n → 6. The sequence converges to the fixed point 6, approaching it from below since (0.5)^n > 0 for all n.',
    bareme: [
      { criterion: 'Computes v_{n+1} in terms of u_n', points: 1 },
      { criterion: 'Factorises to show v_{n+1} = 0.5·v_n', points: 1 },
      { criterion: 'States ratio 0.5 and first term −1', points: 1 },
      { criterion: 'Gives v_n = −(0.5)^n', points: 1 },
      { criterion: 'Deduces u_n = 6 − (0.5)^n', points: 1 },
      { criterion: 'Concludes the limit is 6 with justification', points: 1 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 0 },
  },
  {
    chapter: 'The exponential function',
    subject: 'Mathematics',
    questionType: 'problem',
    difficulty: 0.7,
    contentText:
      'Consider f(x) = (x − 1)·e^x defined on ℝ.\n\n1. Compute f′(x) and study its sign.\n2. Draw up the table of variations of f, including the limits at −∞ and +∞.\n3. Show that the equation f(x) = 0 has a unique solution and give it.',
    contentLatex:
      'Consider $f(x) = (x-1)e^{x}$ on $\\mathbb{R}$.\n\n1. Compute $f\'(x)$ and study its sign.\n2. Draw up the table of variations of $f$, including $\\lim_{x \\to -\\infty} f(x)$ and $\\lim_{x \\to +\\infty} f(x)$.\n3. Show that $f(x) = 0$ has a unique solution and give it.',
    officialSolution:
      '1. f is a product: f′(x) = 1·e^x + (x − 1)e^x = x·e^x. Since e^x > 0 for all x, f′(x) has the sign of x: negative on (−∞, 0), zero at 0, positive on (0, +∞).\n\n2. f decreases on (−∞, 0] and increases on [0, +∞), with a minimum f(0) = −1. As x → −∞, x·e^x → 0 and e^x → 0 so f(x) → 0⁻. As x → +∞, f(x) → +∞.\n\n3. On (−∞, 0] the function decreases from 0⁻ to −1 and is strictly negative, so there is no root there. On [0, +∞) it is continuous and strictly increasing from −1 to +∞, so by the intermediate value theorem there is exactly one root. f(1) = 0, so that root is x = 1.',
    bareme: [
      { criterion: 'Applies the product rule correctly', points: 1 },
      { criterion: 'Simplifies to f′(x) = x·e^x', points: 1 },
      { criterion: 'Deduces the sign of f′ from the sign of x', points: 1 },
      { criterion: 'Correct limits at −∞ and +∞', points: 1.5 },
      { criterion: 'Correct table of variations with the minimum at (0, −1)', points: 1.5 },
      { criterion: 'Uses the intermediate value theorem on the increasing branch', points: 1 },
      { criterion: 'Concludes x = 1 is the unique solution', points: 1 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 1 },
  },
  {
    chapter: 'Integral calculus',
    subject: 'Mathematics',
    questionType: 'open',
    difficulty: 0.6,
    contentText: 'Compute I = ∫₀¹ x·e^{x²} dx, showing the substitution used.',
    contentLatex: 'Compute $I = \\int_0^1 x\\,e^{x^{2}}\\,dx$, showing the substitution used.',
    officialSolution:
      'Let u = x², so du = 2x dx and x dx = du/2. When x = 0, u = 0; when x = 1, u = 1.\n\nI = ∫₀¹ e^u · du/2 = ½[e^u]₀¹ = ½(e − 1) ≈ 0.859.',
    bareme: [
      { criterion: 'Chooses the substitution u = x²', points: 1 },
      { criterion: 'Transforms x dx into du/2 correctly', points: 1 },
      { criterion: 'Changes the limits of integration', points: 1 },
      { criterion: 'Correct final value ½(e − 1)', points: 1 },
    ],
  },
  {
    chapter: 'Conditional probability',
    subject: 'Mathematics',
    questionType: 'problem',
    difficulty: 0.55,
    contentText:
      'A screening test for a disease affecting 2% of a population gives a positive result for 95% of ill people and for 4% of healthy people.\n\n1. Draw the tree of probabilities.\n2. Compute the probability that a person chosen at random tests positive.\n3. A person tests positive. Compute the probability that they are actually ill, and comment.',
    contentLatex:
      'A screening test for a disease affecting $2\\%$ of a population is positive for $95\\%$ of ill people and $4\\%$ of healthy people.\n\n1. Draw the probability tree.\n2. Compute $P(T)$, the probability of testing positive.\n3. Compute $P(M \\mid T)$ and comment.',
    officialSolution:
      '1. Let M be "ill" and T be "positive". P(M) = 0.02, P(T|M) = 0.95, P(T|M̄) = 0.04.\n\n2. By the law of total probability: P(T) = P(M)·P(T|M) + P(M̄)·P(T|M̄) = 0.02 × 0.95 + 0.98 × 0.04 = 0.019 + 0.0392 = 0.0582.\n\n3. P(M|T) = P(M ∩ T)/P(T) = 0.019/0.0582 ≈ 0.326. Barely a third of positive results correspond to an ill person: because the disease is rare, the 4% of false positives among the large healthy group outnumber the true positives. A positive result must therefore be confirmed by a second, more specific test.',
    bareme: [
      { criterion: 'Tree correctly labelled with the three given probabilities', points: 1.5 },
      { criterion: 'Applies the law of total probability', points: 1.5 },
      { criterion: 'Correct value P(T) = 0.0582', points: 1 },
      { criterion: 'Applies the conditional probability formula for P(M|T)', points: 1.5 },
      { criterion: 'Correct value ≈ 0.326', points: 1 },
      { criterion: 'Comments sensibly on false positives in a rare disease', points: 1.5 },
    ],
    cycle: { year: 2022, session: 'session1', orderIndex: 0 },
  },
  {
    chapter: 'Probability distributions',
    subject: 'Mathematics',
    questionType: 'mcq',
    difficulty: 0.4,
    contentText:
      'X follows a binomial distribution with n = 10 and p = 0.3. What is the expected value E(X)?',
    contentLatex: '$X \\sim \\mathcal{B}(10,\\ 0.3)$. What is $E(X)$?',
    options: [
      { id: 'a', text: '0.3' },
      { id: 'b', text: '3' },
      { id: 'c', text: '2.1' },
      { id: 'd', text: '7' },
    ],
    correctOptionId: 'b',
    officialSolution: 'For a binomial distribution, E(X) = n·p = 10 × 0.3 = 3. (The variance would be n·p·(1−p) = 2.1, which is answer c — a common confusion.)',
  },

  // ============================ CHEMISTRY =================================
  {
    chapter: 'Rate of reaction',
    subject: 'Chemistry',
    questionType: 'open',
    difficulty: 0.5,
    contentText:
      'The reaction between zinc and hydrochloric acid is followed by measuring the volume of hydrogen released over time. The curve is steep at first and then flattens.\n\n1. Define the rate of reaction and explain the shape of the curve.\n2. State two factors that would increase the initial rate, justifying each.',
    officialSolution:
      '1. The rate of reaction is the amount of product formed (or reactant consumed) per unit time, given at any instant by the slope of the tangent to the curve. The curve is steep at the start because the concentration of H₃O⁺ is highest then; as the acid is consumed the concentration falls, collisions become less frequent, and the rate decreases until the curve flattens when a reactant is exhausted.\n\n2. Raising the temperature increases the kinetic energy of the particles, so collisions are more frequent and a greater fraction exceed the activation energy. Increasing the concentration of the acid — or the surface area of the zinc, by using powder rather than granules — increases the frequency of effective collisions.',
    bareme: [
      { criterion: 'Defines rate as amount per unit time / slope of the tangent', points: 1 },
      { criterion: 'Links the decreasing slope to falling reactant concentration', points: 1.5 },
      { criterion: 'First factor with a collision-based justification', points: 1.5 },
      { criterion: 'Second factor with a collision-based justification', points: 1 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 0 },
  },
  {
    chapter: 'Chemical equilibrium',
    subject: 'Chemistry',
    questionType: 'mcq',
    difficulty: 0.45,
    contentText:
      'For the equilibrium N₂(g) + 3H₂(g) ⇌ 2NH₃(g), ΔH < 0. Increasing the temperature at constant pressure will:',
    options: [
      { id: 'a', text: 'Shift the equilibrium towards ammonia' },
      { id: 'b', text: 'Shift the equilibrium towards the reactants' },
      { id: 'c', text: 'Leave the position of equilibrium unchanged' },
      { id: 'd', text: 'Stop the reaction entirely' },
    ],
    correctOptionId: 'b',
    officialSolution:
      'The forward reaction is exothermic, so the reverse reaction is endothermic. By Le Chatelier’s principle the system opposes the imposed rise in temperature by favouring the endothermic direction — towards N₂ and H₂. Note that the rate of both reactions increases; it is the position of equilibrium that shifts back.',
  },
  {
    chapter: 'Acids and bases',
    subject: 'Chemistry',
    questionType: 'problem',
    difficulty: 0.6,
    contentText:
      'A 20.0 mL sample of ethanoic acid of unknown concentration is titrated with sodium hydroxide of concentration 0.100 mol·L⁻¹. The equivalence point is reached after 16.0 mL, and the pH at equivalence is 8.7.\n\n1. Write the equation of the titration reaction.\n2. Determine the concentration of the acid.\n3. Explain why the pH at equivalence is above 7.',
    officialSolution:
      '1. CH₃COOH + HO⁻ → CH₃COO⁻ + H₂O.\n\n2. At equivalence the reactants are in stoichiometric proportions: n(acid) = n(HO⁻) = C_b × V_b = 0.100 × 16.0×10⁻³ = 1.60×10⁻³ mol. Hence C_a = n/V_a = 1.60×10⁻³ / 20.0×10⁻³ = 8.00×10⁻² mol·L⁻¹.\n\n3. At equivalence the solution contains the ethanoate ion CH₃COO⁻, the conjugate base of a weak acid. It reacts partially with water: CH₃COO⁻ + H₂O ⇌ CH₃COOH + HO⁻, releasing hydroxide ions and making the solution basic.',
    bareme: [
      { criterion: 'Correct balanced equation', points: 1 },
      { criterion: 'States the stoichiometric relation at equivalence', points: 1 },
      { criterion: 'Computes n(HO⁻) = 1.60×10⁻³ mol', points: 1 },
      { criterion: 'Concludes C_a = 8.00×10⁻² mol·L⁻¹ with units', points: 1 },
      { criterion: 'Identifies ethanoate as a weak conjugate base', points: 1 },
      { criterion: 'Writes its reaction with water and concludes pH > 7', points: 1 },
    ],
  },
  {
    chapter: 'Esterification and hydrolysis',
    subject: 'Chemistry',
    questionType: 'open',
    difficulty: 0.55,
    contentText:
      'Ethanoic acid reacts with ethanol to form an ester.\n\n1. Write the equation and name the ester.\n2. The reaction is slow and limited. State one way to increase the rate without changing the yield, and one way to increase the yield, justifying both.',
    officialSolution:
      '1. CH₃COOH + CH₃CH₂OH ⇌ CH₃COOCH₂CH₃ + H₂O. The ester is ethyl ethanoate.\n\n2. Rate without yield: adding a few drops of concentrated sulfuric acid as a catalyst, or heating. A catalyst lowers the activation energy and heating speeds both directions equally — neither changes the position of equilibrium. Yield: removing the water as it forms, or using an excess of one reactant. By Le Chatelier’s principle the system then shifts towards the ester.',
    bareme: [
      { criterion: 'Correct equation with the equilibrium arrow', points: 1 },
      { criterion: 'Names ethyl ethanoate', points: 1 },
      { criterion: 'Gives a rate factor and explains it does not shift equilibrium', points: 1.5 },
      { criterion: 'Gives a yield factor justified by Le Chatelier', points: 1.5 },
    ],
  },
  {
    chapter: 'Organic functional groups',
    subject: 'Chemistry',
    questionType: 'mcq',
    difficulty: 0.3,
    contentText: 'Which functional group characterises the compound CH₃—CO—CH₃?',
    options: [
      { id: 'a', text: 'Aldehyde' },
      { id: 'b', text: 'Ketone' },
      { id: 'c', text: 'Carboxylic acid' },
      { id: 'd', text: 'Ester' },
    ],
    correctOptionId: 'b',
    officialSolution:
      'The carbonyl group is carried by a carbon bonded to two other carbon atoms, which defines a ketone (propanone). In an aldehyde the carbonyl carbon carries at least one hydrogen.',
  },

  // ============================= PHYSICS ==================================
  {
    chapter: 'Newton’s laws',
    subject: 'Physics',
    questionType: 'problem',
    difficulty: 0.6,
    contentText:
      'A block of mass m = 2.0 kg slides down a frictionless incline making an angle α = 30° with the horizontal. Take g = 10 m·s⁻².\n\n1. List the forces acting on the block and draw them.\n2. Apply Newton’s second law and determine the acceleration.\n3. The block starts from rest. Determine its speed after travelling 4.0 m along the incline.',
    officialSolution:
      '1. Two forces: the weight W = mg, vertical and downwards, and the normal reaction N, perpendicular to the incline. There is no friction.\n\n2. Projecting Newton’s second law on the axis along the incline, taken positive downwards: mg·sin α = m·a, so a = g·sin α = 10 × 0.5 = 5.0 m·s⁻². (Perpendicular to the incline: N = mg·cos α.)\n\n3. With constant acceleration from rest, v² = 2·a·d = 2 × 5.0 × 4.0 = 40, so v = 6.3 m·s⁻¹.',
    bareme: [
      { criterion: 'Identifies weight and normal reaction, no friction', points: 1 },
      { criterion: 'Projects correctly along the incline', points: 1.5 },
      { criterion: 'Obtains a = g·sin α = 5.0 m·s⁻²', points: 1.5 },
      { criterion: 'Uses v² = 2ad correctly', points: 1 },
      { criterion: 'Final speed 6.3 m·s⁻¹ with units', points: 1 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 0 },
  },
  {
    chapter: 'Mechanical oscillations',
    subject: 'Physics',
    questionType: 'open',
    difficulty: 0.55,
    contentText:
      'A mass–spring oscillator of mass m = 0.20 kg and stiffness k = 20 N·m⁻¹ oscillates horizontally without friction.\n\n1. Establish the differential equation of motion.\n2. Deduce the proper period and compute it.',
    officialSolution:
      '1. The only horizontal force is the restoring force of the spring, −kx. Newton’s second law gives m·ẍ = −k·x, that is ẍ + (k/m)·x = 0.\n\n2. This is the equation of a simple harmonic oscillator with ω₀² = k/m, so T₀ = 2π√(m/k) = 2π√(0.20/20) = 2π√0.01 = 2π × 0.1 ≈ 0.63 s.',
    bareme: [
      { criterion: 'Identifies the restoring force −kx', points: 1 },
      { criterion: 'Writes the differential equation ẍ + (k/m)x = 0', points: 1.5 },
      { criterion: 'Gives T₀ = 2π√(m/k)', points: 1 },
      { criterion: 'Computes T₀ ≈ 0.63 s with units', points: 1 },
    ],
  },
  {
    chapter: 'Radioactivity',
    subject: 'Physics',
    questionType: 'open',
    difficulty: 0.5,
    contentText:
      'A sample contains N₀ = 8.0 × 10¹⁰ nuclei of a radioactive isotope whose half-life is 5.0 days.\n\n1. Define the half-life.\n2. Determine the number of nuclei remaining after 15 days.\n3. Deduce the radioactive constant λ.',
    officialSolution:
      '1. The half-life T is the time after which half of the radioactive nuclei initially present have disintegrated.\n\n2. 15 days is exactly three half-lives, so N = N₀/2³ = 8.0×10¹⁰ / 8 = 1.0×10¹⁰ nuclei.\n\n3. λ = ln 2 / T = 0.693 / 5.0 = 0.139 day⁻¹, that is about 1.6×10⁻⁶ s⁻¹.',
    bareme: [
      { criterion: 'Correct definition of half-life', points: 1 },
      { criterion: 'Recognises 15 days as three half-lives', points: 1 },
      { criterion: 'Computes N = 1.0×10¹⁰ nuclei', points: 1 },
      { criterion: 'Uses λ = ln2 / T and computes it with units', points: 1 },
    ],
  },
  {
    chapter: 'Electromagnetic induction',
    subject: 'Physics',
    questionType: 'mcq',
    difficulty: 0.45,
    contentText:
      'A magnet is pushed towards a coil connected to a galvanometer. The induced current in the coil:',
    options: [
      { id: 'a', text: 'Flows so that the coil attracts the magnet' },
      { id: 'b', text: 'Flows so that the coil opposes the approach of the magnet' },
      { id: 'c', text: 'Is zero because the circuit contains no generator' },
      { id: 'd', text: 'Depends only on the strength of the magnet, not its motion' },
    ],
    correctOptionId: 'b',
    officialSolution:
      'By Lenz’s law the induced current opposes the cause that produced it. The coil therefore presents a like pole to the approaching magnet and repels it. This is a consequence of energy conservation: work must be done to push the magnet in.',
  },
];

export type DemoContentChunk = {
  chapter: string;
  subject: string;
  kind: 'definition' | 'formula' | 'theorem' | 'method' | 'worked_example';
  title: string;
  contentText: string;
};

/**
 * Course material — the tier-2 retrieval corpus.
 *
 * This is what the tutor is allowed to answer from when no past question
 * matches closely enough. Without it, tier 2 can never fire and every
 * conceptual question is refused, which makes for a very short demo.
 */
export const DEMO_CONTENT_CHUNKS: DemoContentChunk[] = [
  {
    chapter: 'Transcription and translation',
    subject: 'Life Sciences',
    kind: 'method',
    title: 'Reading a template strand into a peptide',
    contentText:
      'Write the mRNA complementary and antiparallel to the template strand: A pairs with U, T with A, G with C, C with G. Then locate the start codon AUG and read the codons in threes from there. Translate each codon with the genetic code table and stop at the first stop codon (UAA, UAG, UGA), which codes for no amino acid.',
  },
  {
    chapter: 'Transcription and translation',
    subject: 'Life Sciences',
    kind: 'definition',
    title: 'Properties of the genetic code',
    contentText:
      'The genetic code is universal (the same in nearly all living organisms), redundant (several codons may specify the same amino acid) and non-ambiguous (one codon specifies one amino acid only). It is read in non-overlapping triplets from a fixed starting point.',
  },
  {
    chapter: 'Adaptive immunity',
    subject: 'Life Sciences',
    kind: 'definition',
    title: 'Primary and secondary responses',
    contentText:
      'The primary response follows a first encounter with an antigen. It is slow (about ten days), of low intensity, and produces both effector cells and memory lymphocytes. The secondary response follows a later encounter with the same antigen: memory cells are already selected and numerous, so it is faster (two to three days), far more intense and longer lasting.',
  },
  {
    chapter: 'The nerve message',
    subject: 'Life Sciences',
    kind: 'definition',
    title: 'The all-or-none law and frequency coding',
    contentText:
      'Below the threshold intensity no action potential is generated. At or above it, the action potential always has the same amplitude regardless of stimulus strength. Along a single fibre the intensity of a stimulus is therefore coded by the frequency of action potentials, limited by the refractory period; across a whole nerve it is additionally coded by the number of fibres recruited.',
  },
  {
    chapter: 'Numerical sequences',
    subject: 'Mathematics',
    kind: 'method',
    title: 'Showing an auxiliary sequence is geometric',
    contentText:
      'For a sequence defined by u_{n+1} = a·u_n + b with a ≠ 1, set v_n = u_n − L where L = b/(1−a) is the fixed point. Compute v_{n+1} = u_{n+1} − L, substitute the recurrence and factorise to obtain v_{n+1} = a·v_n. Then v_n = v_0·a^n and u_n = v_n + L.',
  },
  {
    chapter: 'The exponential function',
    subject: 'Mathematics',
    kind: 'formula',
    title: 'Derivative of a product involving e^x',
    contentText:
      'If f(x) = u(x)·e^x then f′(x) = (u(x) + u′(x))·e^x. Since e^x > 0 for all real x, the sign of f′ is the sign of u(x) + u′(x), which is usually where the study of variations begins.',
  },
  {
    chapter: 'Integral calculus',
    subject: 'Mathematics',
    kind: 'method',
    title: 'Integration by substitution',
    contentText:
      'To compute ∫ f(g(x))·g′(x) dx, set u = g(x) so that du = g′(x) dx. Rewrite the integral entirely in terms of u, and convert the limits of integration as well when the integral is definite: the new limits are g(a) and g(b). Forgetting to convert the limits is the commonest error.',
  },
  {
    chapter: 'Conditional probability',
    subject: 'Mathematics',
    kind: 'theorem',
    title: 'Law of total probability and Bayes',
    contentText:
      'If A and its complement Ā partition the universe, then P(B) = P(A)·P(B|A) + P(Ā)·P(B|Ā). The conditional probability is P(A|B) = P(A ∩ B)/P(B). For a rare event A, P(A|B) can be small even when P(B|A) is close to 1, because the false positives from the large complement dominate.',
  },
  {
    chapter: 'Rate of reaction',
    subject: 'Chemistry',
    kind: 'definition',
    title: 'Kinetic factors',
    contentText:
      'The rate of a reaction increases with temperature (particles collide more often and more energetically), with the concentration of the reactants, and with the surface area of a solid reactant. A catalyst increases the rate by providing a path of lower activation energy without being consumed and without changing the position of equilibrium.',
  },
  {
    chapter: 'Chemical equilibrium',
    subject: 'Chemistry',
    kind: 'theorem',
    title: 'Le Chatelier’s principle',
    contentText:
      'When a constraint is imposed on a system at equilibrium, the system evolves in the direction that opposes that constraint. Raising the temperature favours the endothermic direction; raising the pressure favours the side with fewer moles of gas; removing a product favours the forward reaction.',
  },
  {
    chapter: 'Acids and bases',
    subject: 'Chemistry',
    kind: 'method',
    title: 'Exploiting the equivalence point of a titration',
    contentText:
      'At equivalence the reactants have been mixed in stoichiometric proportions, so n(acid) = n(base) for a one-to-one reaction. From the volume of titrant added, n = C·V gives the amount, and dividing by the sample volume gives the unknown concentration. The pH at equivalence is above 7 when a weak acid is titrated by a strong base, because the conjugate base formed reacts with water.',
  },
  {
    chapter: 'Newton’s laws',
    subject: 'Physics',
    kind: 'method',
    title: 'Applying the second law on an incline',
    contentText:
      'Choose an axis along the incline and one perpendicular to it. Project the weight: mg·sin α along the incline, mg·cos α perpendicular to it. The normal reaction has no component along the incline. Newton’s second law along the incline then gives m·a = mg·sin α − f, which reduces to a = g·sin α when friction f is negligible.',
  },
  {
    chapter: 'Mechanical oscillations',
    subject: 'Physics',
    kind: 'formula',
    title: 'Proper period of a mass–spring oscillator',
    contentText:
      'For a horizontal mass–spring system without friction, m·ẍ + k·x = 0, so ω₀ = √(k/m) and the proper period is T₀ = 2π√(m/k). The period depends on the mass and the stiffness only — not on the amplitude, which is what makes the oscillator isochronous.',
  },
  {
    chapter: 'Radioactivity',
    subject: 'Physics',
    kind: 'formula',
    title: 'Decay law and half-life',
    contentText:
      'The number of surviving nuclei follows N(t) = N₀·e^{−λt}. The half-life T is defined by N(T) = N₀/2, which gives T = ln2/λ. After n half-lives, N = N₀/2ⁿ — the fastest route through a problem when the elapsed time is a whole number of half-lives.',
  },
];
