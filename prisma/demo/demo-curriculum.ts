/**
 * DEMONSTRATION QUESTIONS — written for this repository, not ministry papers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What changed, and why it matters.
 *
 * This file used to carry its own invented chapter list. It no longer does.
 * Every question below is filed against a chapter that exists in the real
 * curriculum — the one `prisma/taxonomy-loader.ts` reads out of the transcribed
 * CRDP textbooks' own contents pages. If a chapter name here stops matching,
 * the demo seed says so loudly rather than inventing a chapter to hold it.
 *
 * So the *structure* is genuinely the Lebanese LS programme: Reproduction and
 * Genetics, Immunology, Neurophysiology, Systems of Regulation, Evolution, and
 * the maths, physics and chemistry chapters as the Grade 12 books order them.
 *
 * The *questions* are still written here. They are at the level and in the
 * style of the programme, and their barèmes follow Lebanese marking convention
 * — method marks before answer marks — but they are not transcriptions of real
 * papers. Real questions arrive through `npm run ingest`, into these same
 * tables. Every demo exam cycle is titled "(illustrative)" and the demo account
 * opens with an announcement saying exactly this.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The demo student sits in Life Sciences, the English-section stream. */
export const DEMO_TRACK_CODE = 'LS';
export const DEMO_LANGUAGE = 'en' as const;

export const DEMO_NOTICE_TITLE = 'Demonstration account';
export const DEMO_NOTICE_BODY =
  'The subjects, units and chapters in this account are the real Lebanese Life Sciences programme, ' +
  'read from the official textbooks. The questions and marking schemes were written to demonstrate ' +
  'the system and are not official ministry papers — real papers are loaded through the ingestion pipeline.';

export type DemoExamCycle = {
  subject: string;
  year: number;
  session: string;
  title: string;
  durationMinutes: number;
};

/**
 * Illustrative cycles across four years.
 *
 * Durations follow the official sitting lengths for the LS branch: three hours
 * for Life Sciences and Mathematics, two for Physics and Chemistry. A demo of
 * an exam simulator that runs for the wrong length is a demo of the wrong
 * product.
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
  /** Must match a chapter name in the real taxonomy, exactly. */
  chapter: string;
  subject: string;
  questionType: 'mcq' | 'open' | 'problem';
  difficulty: number;
  contentText: string;
  contentLatex?: string;
  options?: { id: string; text: string }[];
  correctOptionId?: string;
  officialSolution?: string;
  bareme?: { criterion: string; points: number }[];
  cycle?: { year: number; session: string; orderIndex: number };
};

export const DEMO_QUESTIONS: DemoQuestion[] = [
  // ============ LIFE SCIENCES — Reproduction and Genetics ============
  {
    chapter: 'Transmission of genes and genetic recombination',
    subject: 'Life Sciences',
    questionType: 'mcq',
    difficulty: 0.3,
    contentText:
      'In a diploid cell heterozygous for two genes carried by the same pair of chromosomes, recombinant gametes are produced by:',
    options: [
      { id: 'a', text: 'Independent assortment of the two chromosomes at anaphase I' },
      { id: 'b', text: 'Crossing over between the two loci during prophase I' },
      { id: 'c', text: 'Separation of the sister chromatids at anaphase II' },
      { id: 'd', text: 'Fusion of the two gametes at fertilisation' },
    ],
    correctOptionId: 'b',
    officialSolution:
      'The two genes are linked — carried by the same pair of chromosomes — so independent assortment cannot separate them. Only a crossing over between the two loci, during prophase I of meiosis, exchanges segments between homologous chromatids and produces recombinant gametes. Anaphase II separates sister chromatids and creates no new combination; fertilisation happens after the gametes are formed.',
  },
  {
    chapter: 'Transmission of genes and genetic recombination',
    subject: 'Life Sciences',
    questionType: 'open',
    difficulty: 0.6,
    contentText:
      'A test cross between a doubly heterozygous fruit fly and a doubly recessive individual gives the following offspring:\n\n  parental types  412 + 388\n  recombinant types  96 + 104\n\n1. Explain why this cross is called a test cross.\n2. Determine whether the two genes are linked or independent, justifying your answer with a calculation.\n3. Calculate the distance between the two loci in centimorgans.',
    officialSolution:
      '1. In a test cross the heterozygote is crossed with a doubly recessive individual. The recessive parent produces one type of gamete only, so the proportions of the offspring read directly as the proportions of the gametes made by the heterozygote.\n\n2. Total offspring = 412 + 388 + 96 + 104 = 1 000. If the genes were independent the four classes would each be about 25%. Here the parental types make up 800/1000 = 80% and the recombinants 200/1000 = 20%. The four classes are not equal, so the genes are linked.\n\n3. Distance = percentage of recombinants = 20%, that is 20 centimorgans.',
    bareme: [
      { criterion: 'Defines the test cross as a cross with a doubly recessive individual', points: 1 },
      { criterion: 'States that the recessive parent gives one gamete type, so offspring reveal the gametes', points: 1 },
      { criterion: 'Computes the recombinant percentage', points: 1.5 },
      { criterion: 'Concludes the genes are linked, with the four classes not equal as justification', points: 1.5 },
      { criterion: 'Gives the distance as 20 cM', points: 1 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 0 },
  },
  {
    chapter: 'Human Genetics',
    subject: 'Life Sciences',
    questionType: 'open',
    difficulty: 0.65,
    contentText:
      'In a family pedigree, two unaffected parents have an affected son and an unaffected daughter. The father’s brother is also affected.\n\n1. Determine whether the allele responsible is dominant or recessive, justifying your answer.\n2. Determine whether the gene is carried by an autosome or by the X chromosome, justifying your answer.',
    officialSolution:
      '1. The allele is recessive. Both parents are unaffected yet have an affected son, so each parent carries the allele without expressing it — the affected phenotype only appears when the allele is present in two copies (or hemizygous).\n\n2. The pedigree is compatible with X-linked recessive inheritance: the affected individuals are male, and the mother is a heterozygous carrier who transmits the X carrying the allele to her son. It cannot be ruled out as autosomal recessive from this pedigree alone — that must be said. If the affected son had an affected daughter in a later generation whose father was unaffected, autosomal would be established.',
    bareme: [
      { criterion: 'Concludes recessive', points: 1 },
      { criterion: 'Justifies with unaffected parents having an affected child', points: 1.5 },
      { criterion: 'Proposes X-linked recessive with the carrier mother', points: 1.5 },
      { criterion: 'States that autosomal recessive cannot be excluded from this pedigree', points: 1 },
    ],
  },

  // ==================== LIFE SCIENCES — Immunology ====================
  {
    chapter: 'Role and components of the immune system',
    subject: 'Life Sciences',
    questionType: 'mcq',
    difficulty: 0.25,
    contentText: 'Which of the following belongs to the innate, non-specific immune response?',
    options: [
      { id: 'a', text: 'The secretion of antibodies by plasma cells' },
      { id: 'b', text: 'The inflammatory reaction and phagocytosis' },
      { id: 'c', text: 'The clonal selection of B lymphocytes' },
      { id: 'd', text: 'The formation of memory lymphocytes' },
    ],
    correctOptionId: 'b',
    officialSolution:
      'Inflammation and phagocytosis are immediate, identical whatever the intruder, and require no prior encounter — they are innate. Antibody secretion, clonal selection and memory all belong to the adaptive response.',
  },
  {
    chapter: 'The immune response',
    subject: 'Life Sciences',
    questionType: 'open',
    difficulty: 0.6,
    contentText:
      'A patient meets a virus for the first time. Specific antibodies appear in the blood from the tenth day and then decline. Two years later the same virus is met again, and the antibody level rises within two days to a much higher value.\n\n1. Name the type of response involved and the cells that secrete the antibodies.\n2. Explain the difference in speed and in intensity between the two responses.',
    officialSolution:
      '1. This is the adaptive humoral response. The antibodies are secreted by plasma cells, the effector cells produced by the differentiation of activated B lymphocytes.\n\n2. On first contact the rare B lymphocytes whose receptor is complementary to the antigen must be selected, must multiply (clonal expansion) and must differentiate — about ten days. This primary response also produces memory lymphocytes. On second contact those memory cells are already selected and numerous, so they differentiate into plasma cells almost at once: the secondary response is faster, more intense and longer lasting.',
    bareme: [
      { criterion: 'Identifies the adaptive humoral response', points: 1 },
      { criterion: 'Names plasma cells as the secreting cells', points: 1 },
      { criterion: 'Explains selection, clonal expansion and differentiation in the primary response', points: 2 },
      { criterion: 'Explains the role of memory lymphocytes in the secondary response', points: 2 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 1 },
  },
  {
    chapter: 'Disorders of the Immune System',
    subject: 'Life Sciences',
    questionType: 'open',
    difficulty: 0.55,
    contentText:
      'Explain, in terms of immune memory, why a vaccine is given before exposure to a pathogen whereas a serum is given after. State one limitation of each.',
    officialSolution:
      'A vaccine introduces an antigen made harmless. It triggers a primary adaptive response and, above all, memory lymphocytes, which takes days to weeks — hence it must be given before exposure. Its protection is long-lasting but not immediate.\n\nA serum supplies ready-made specific antibodies. Protection is immediate, which is why it is given after exposure, but the recipient makes no memory cells, so protection disappears as the injected antibodies are degraded.',
    bareme: [
      { criterion: 'Vaccine described as an active response producing memory cells', points: 1.5 },
      { criterion: 'Serum described as passive, supplying ready-made antibodies', points: 1.5 },
      { criterion: 'Limitation of the vaccine: delay before protection', points: 1 },
      { criterion: 'Limitation of the serum: no memory, short-lived protection', points: 1 },
    ],
  },

  // ================= LIFE SCIENCES — Neurophysiology =================
  {
    chapter: 'Function of neurons',
    subject: 'Life Sciences',
    questionType: 'open',
    difficulty: 0.6,
    contentText:
      'Two stimulations of increasing intensity are applied to a nerve fibre. The first, below threshold, produces no action potential. The second produces a train of action potentials of constant amplitude but increasing frequency.\n\n1. State the law illustrated by the constant amplitude.\n2. Explain how the intensity of a stimulus is coded along a single fibre.',
    officialSolution:
      '1. The all-or-none law: below threshold no action potential is produced; at or above it the action potential always has the same amplitude, independent of stimulus intensity.\n\n2. Along one fibre, intensity is coded by frequency modulation — the stronger the stimulus, the higher the frequency of action potentials, up to the limit imposed by the refractory period. Across a whole nerve, intensity is additionally coded by the number of fibres recruited.',
    bareme: [
      { criterion: 'States the all-or-none law correctly', points: 1.5 },
      { criterion: 'Identifies frequency coding of intensity', points: 1.5 },
      { criterion: 'Mentions the limit set by the refractory period', points: 1 },
    ],
  },
  {
    chapter: 'Myotatic reflex',
    subject: 'Life Sciences',
    questionType: 'open',
    difficulty: 0.5,
    contentText:
      'A tap on the patellar tendon produces an involuntary extension of the leg.\n\n1. Name, in order, the five elements of the reflex arc involved.\n2. State two properties of this reflex that distinguish it from a voluntary movement.',
    officialSolution:
      '1. The receptor (the neuromuscular spindle in the stretched muscle) → the afferent (sensory) neuron → the centre (the spinal cord, here a monosynaptic connection) → the efferent (motor) neuron → the effector (the extensor muscle).\n\n2. It is involuntary — it needs no command from the brain — and it is stereotyped: the same stimulus always produces the same response, with a short and constant latency.',
    bareme: [
      { criterion: 'Names the five elements of the arc', points: 2.5 },
      { criterion: 'Gives them in the correct order', points: 0.5 },
      { criterion: 'States that the reflex is involuntary', points: 1 },
      { criterion: 'States that it is stereotyped, with a short constant latency', points: 1 },
    ],
    cycle: { year: 2022, session: 'session1', orderIndex: 0 },
  },
  {
    chapter: 'Neurotransmitters and medical applications',
    subject: 'Life Sciences',
    questionType: 'mcq',
    difficulty: 0.4,
    contentText: 'At a chemical synapse, the arrival of an action potential at the presynaptic ending causes:',
    options: [
      { id: 'a', text: 'The entry of Ca²⁺ ions and exocytosis of the neurotransmitter' },
      { id: 'b', text: 'The direct passage of the action potential across the cleft' },
      { id: 'c', text: 'The entry of Cl⁻ ions into the presynaptic ending' },
      { id: 'd', text: 'The synthesis of new receptors on the postsynaptic membrane' },
    ],
    correctOptionId: 'a',
    officialSolution:
      'Depolarisation opens voltage-gated calcium channels; the influx of Ca²⁺ triggers fusion of the synaptic vesicles with the presynaptic membrane and release of the neurotransmitter by exocytosis. Transmission across the cleft is chemical, not electrical, which is what makes the synapse unidirectional.',
  },

  // ============== LIFE SCIENCES — Systems of Regulation ==============
  {
    chapter: 'Regulation of glycemia',
    subject: 'Life Sciences',
    questionType: 'open',
    difficulty: 0.6,
    contentText:
      'After a carbohydrate-rich meal, blood glucose rises from 0.9 g·L⁻¹ to 1.5 g·L⁻¹, then returns to about 0.9 g·L⁻¹ within two hours.\n\n1. Name the hormone responsible for the return to normal, and the cells that secrete it.\n2. Describe two effects of this hormone that lower blood glucose.\n3. Name the antagonistic hormone and the cells that secrete it.',
    officialSolution:
      '1. Insulin, secreted by the β cells of the islets of Langerhans in the pancreas.\n\n2. Insulin increases the uptake of glucose by cells — muscle and adipose tissue in particular — by promoting the insertion of glucose transporters into their membranes; and it stimulates glycogenesis, the storage of glucose as glycogen in the liver and muscle. (It also inhibits glycogenolysis and gluconeogenesis.)\n\n3. Glucagon, secreted by the α cells of the islets of Langerhans.',
    bareme: [
      { criterion: 'Names insulin', points: 1 },
      { criterion: 'Names the β cells of the islets of Langerhans', points: 1 },
      { criterion: 'First effect: increased cellular uptake of glucose', points: 1 },
      { criterion: 'Second effect: glycogenesis in the liver and muscle', points: 1 },
      { criterion: 'Names glucagon and the α cells', points: 1 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 2 },
  },
  {
    chapter: 'Regulation of the female sexual hormones',
    subject: 'Life Sciences',
    questionType: 'open',
    difficulty: 0.7,
    contentText:
      'The plasma concentration of oestradiol rises through the follicular phase. Just before ovulation this rise is followed by a sharp peak of LH.\n\n1. Name the gland that secretes LH and the structure that secretes oestradiol.\n2. Explain how the feedback exerted by oestradiol changes across the cycle.',
    officialSolution:
      '1. LH is secreted by the anterior pituitary (adenohypophysis). Oestradiol is secreted by the ovarian follicle — its granulosa and theca cells.\n\n2. At low and moderate concentrations oestradiol exerts negative feedback on the hypothalamus and the pituitary, limiting FSH and LH secretion. When its concentration passes a threshold and is maintained above it for about 36 hours at the end of the follicular phase, the feedback reverses and becomes positive: the pituitary answers with a massive discharge of LH — the peak that triggers ovulation.',
    bareme: [
      { criterion: 'Identifies the anterior pituitary as the source of LH', points: 1 },
      { criterion: 'Identifies the ovarian follicle as the source of oestradiol', points: 1 },
      { criterion: 'Describes negative feedback at low concentration', points: 1.5 },
      { criterion: 'Describes the reversal to positive feedback above a maintained threshold', points: 1.5 },
      { criterion: 'Links the LH peak to ovulation', points: 1 },
    ],
  },
  {
    chapter: 'Regulation of arterial blood pressure',
    subject: 'Life Sciences',
    questionType: 'mcq',
    difficulty: 0.45,
    contentText: 'A rise in arterial pressure detected by the baroreceptors of the carotid sinus leads to:',
    options: [
      { id: 'a', text: 'An increase in sympathetic activity and a rise in heart rate' },
      { id: 'b', text: 'An increase in parasympathetic activity and a fall in heart rate' },
      { id: 'c', text: 'A decrease in the frequency of messages sent to the bulbar centres' },
      { id: 'd', text: 'Vasoconstriction of the arterioles' },
    ],
    correctOptionId: 'b',
    officialSolution:
      'A rise in pressure increases the frequency of the nerve messages leaving the baroreceptors towards the bulbar centres. The response is corrective: parasympathetic (vagal) activity increases and sympathetic activity decreases, so heart rate and cardiac output fall and the arterioles dilate, bringing pressure back down.',
  },

  // ======================= MATHEMATICS =======================
  {
    chapter: 'Conditional probability',
    subject: 'Mathematics',
    questionType: 'problem',
    difficulty: 0.55,
    contentText:
      'A screening test for a disease affecting 2% of a population is positive for 95% of ill people and for 4% of healthy people.\n\n1. Draw the tree of probabilities.\n2. Compute the probability that a person chosen at random tests positive.\n3. A person tests positive. Compute the probability that they are ill, and comment.',
    contentLatex:
      'A screening test for a disease affecting $2\\%$ of a population is positive for $95\\%$ of ill people and $4\\%$ of healthy people.\n\n1. Draw the probability tree.\n2. Compute $P(T)$.\n3. Compute $P(M \\mid T)$ and comment.',
    officialSolution:
      '1. Let M be "ill" and T be "positive". P(M) = 0.02, P(T|M) = 0.95, P(T|M̄) = 0.04.\n\n2. By the law of total probability: P(T) = 0.02 × 0.95 + 0.98 × 0.04 = 0.019 + 0.0392 = 0.0582.\n\n3. P(M|T) = 0.019 / 0.0582 ≈ 0.326. Barely a third of positive results correspond to an ill person: the disease is rare, so the 4% of false positives drawn from the large healthy group outnumber the true positives. A positive result must be confirmed by a second, more specific test.',
    bareme: [
      { criterion: 'Tree correctly labelled with the three given probabilities', points: 1.5 },
      { criterion: 'Applies the law of total probability', points: 1.5 },
      { criterion: 'Correct value P(T) = 0.0582', points: 1 },
      { criterion: 'Applies the conditional probability formula', points: 1.5 },
      { criterion: 'Correct value ≈ 0.326', points: 1 },
      { criterion: 'Comments on false positives in a rare disease', points: 1.5 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 0 },
  },
  {
    chapter: 'Bernoulli distribution - Binomial distribution',
    subject: 'Mathematics',
    questionType: 'mcq',
    difficulty: 0.4,
    contentText: 'X follows a binomial distribution with n = 10 and p = 0.3. What is E(X)?',
    contentLatex: '$X \\sim \\mathcal{B}(10,\\ 0.3)$. What is $E(X)$?',
    options: [
      { id: 'a', text: '0.3' },
      { id: 'b', text: '3' },
      { id: 'c', text: '2.1' },
      { id: 'd', text: '7' },
    ],
    correctOptionId: 'b',
    officialSolution:
      'For a binomial distribution E(X) = n·p = 10 × 0.3 = 3. The variance is n·p·(1−p) = 2.1, which is answer c — the usual confusion.',
  },
  {
    chapter: 'Exponential functions',
    subject: 'Mathematics',
    questionType: 'problem',
    difficulty: 0.7,
    contentText:
      'Consider f(x) = (x − 1)·e^x on ℝ.\n\n1. Compute f′(x) and study its sign.\n2. Draw up the table of variations of f, with the limits at −∞ and +∞.\n3. Show that f(x) = 0 has a unique solution and give it.',
    contentLatex:
      'Consider $f(x) = (x-1)e^{x}$ on $\\mathbb{R}$.\n\n1. Compute $f\'(x)$ and study its sign.\n2. Draw up the table of variations, with $\\lim_{x \\to -\\infty} f(x)$ and $\\lim_{x \\to +\\infty} f(x)$.\n3. Show $f(x)=0$ has a unique solution and give it.',
    officialSolution:
      '1. f is a product: f′(x) = e^x + (x − 1)e^x = x·e^x. Since e^x > 0 for all x, f′ has the sign of x — negative on (−∞, 0), zero at 0, positive on (0, +∞).\n\n2. f decreases on (−∞, 0] and increases on [0, +∞), with minimum f(0) = −1. As x → −∞, f(x) → 0⁻; as x → +∞, f(x) → +∞.\n\n3. On (−∞, 0] the function is strictly negative, so no root. On [0, +∞) it is continuous and strictly increasing from −1 to +∞, so by the intermediate value theorem there is exactly one root. f(1) = 0, so x = 1.',
    bareme: [
      { criterion: 'Applies the product rule', points: 1 },
      { criterion: 'Simplifies to f′(x) = x·e^x', points: 1 },
      { criterion: 'Deduces the sign of f′ from the sign of x', points: 1 },
      { criterion: 'Correct limits at −∞ and +∞', points: 1.5 },
      { criterion: 'Correct table of variations with the minimum (0, −1)', points: 1.5 },
      { criterion: 'Uses the intermediate value theorem on the increasing branch', points: 1 },
      { criterion: 'Concludes x = 1 is the unique solution', points: 1 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 1 },
  },
  {
    chapter: 'Methods of integration',
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
    chapter: 'Modulus and argument of a complex number',
    subject: 'Mathematics',
    questionType: 'mcq',
    difficulty: 0.35,
    contentText: 'What is the modulus of z = 3 + 4i?',
    contentLatex: 'What is $|z|$ for $z = 3 + 4i$?',
    options: [
      { id: 'a', text: '7' },
      { id: 'b', text: '5' },
      { id: 'c', text: '25' },
      { id: 'd', text: '√7' },
    ],
    correctOptionId: 'b',
    officialSolution: '|z| = √(3² + 4²) = √(9 + 16) = √25 = 5.',
  },

  // ========================= CHEMISTRY =========================
  {
    chapter: 'Kinetic Factors',
    subject: 'Chemistry',
    questionType: 'open',
    difficulty: 0.5,
    contentText:
      'The reaction between zinc and hydrochloric acid is followed by measuring the volume of hydrogen released. The curve is steep at first and then flattens.\n\n1. Define the rate of reaction and explain the shape of the curve.\n2. State two factors that would increase the initial rate, justifying each.',
    officialSolution:
      '1. The rate of reaction is the amount of product formed per unit time, given at any instant by the slope of the tangent to the curve. It is steep at the start because the concentration of H₃O⁺ is highest then; as the acid is consumed the concentration falls, effective collisions become less frequent and the rate decreases, until the curve flattens when a reactant is exhausted.\n\n2. Raising the temperature increases the kinetic energy of the particles, so collisions are more frequent and a greater fraction exceed the activation energy. Increasing the concentration of the acid — or the surface area of the zinc, by using powder rather than granules — increases the frequency of effective collisions.',
    bareme: [
      { criterion: 'Defines rate as amount per unit time / slope of the tangent', points: 1 },
      { criterion: 'Links the falling slope to falling reactant concentration', points: 1.5 },
      { criterion: 'First factor with a collision-based justification', points: 1.5 },
      { criterion: 'Second factor with a collision-based justification', points: 1 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 0 },
  },
  {
    chapter: 'Chemical Equilibrium',
    subject: 'Chemistry',
    questionType: 'mcq',
    difficulty: 0.45,
    contentText:
      'For the equilibrium N₂(g) + 3H₂(g) ⇌ 2NH₃(g), ΔH < 0. Raising the temperature at constant pressure will:',
    options: [
      { id: 'a', text: 'Shift the equilibrium towards ammonia' },
      { id: 'b', text: 'Shift the equilibrium towards the reactants' },
      { id: 'c', text: 'Leave the position of equilibrium unchanged' },
      { id: 'd', text: 'Stop the reaction entirely' },
    ],
    correctOptionId: 'b',
    officialSolution:
      'The forward reaction is exothermic, so the reverse is endothermic. By Le Chatelier’s principle the system opposes the imposed rise in temperature by favouring the endothermic direction — back towards N₂ and H₂. Both rates increase; it is the position of equilibrium that shifts.',
  },
  {
    chapter: 'Reaction between a weak acid and a strong base',
    subject: 'Chemistry',
    questionType: 'problem',
    difficulty: 0.6,
    contentText:
      '20.0 mL of ethanoic acid of unknown concentration is titrated with sodium hydroxide at 0.100 mol·L⁻¹. Equivalence is reached after 16.0 mL, and the pH at equivalence is 8.7.\n\n1. Write the equation of the titration reaction.\n2. Determine the concentration of the acid.\n3. Explain why the pH at equivalence is above 7.',
    officialSolution:
      '1. CH₃COOH + HO⁻ → CH₃COO⁻ + H₂O.\n\n2. At equivalence the reactants are in stoichiometric proportions: n(acid) = n(HO⁻) = 0.100 × 16.0×10⁻³ = 1.60×10⁻³ mol. So C_a = 1.60×10⁻³ / 20.0×10⁻³ = 8.00×10⁻² mol·L⁻¹.\n\n3. At equivalence the solution contains ethanoate, the conjugate base of a weak acid. It reacts partially with water: CH₃COO⁻ + H₂O ⇌ CH₃COOH + HO⁻, releasing hydroxide ions and making the solution basic.',
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
    chapter: 'Carboxylic acids and their derivatives',
    subject: 'Chemistry',
    questionType: 'open',
    difficulty: 0.55,
    contentText:
      'Ethanoic acid reacts with ethanol to give an ester.\n\n1. Write the equation and name the ester.\n2. The reaction is slow and limited. Give one way to increase the rate without changing the yield, and one way to increase the yield, justifying both.',
    officialSolution:
      '1. CH₃COOH + CH₃CH₂OH ⇌ CH₃COOCH₂CH₃ + H₂O. The ester is ethyl ethanoate.\n\n2. Rate without yield: a few drops of concentrated sulfuric acid as catalyst, or heating. A catalyst lowers the activation energy and heating speeds both directions equally, so neither moves the equilibrium. Yield: remove the water as it forms, or use an excess of one reactant — by Le Chatelier’s principle the system then shifts towards the ester.',
    bareme: [
      { criterion: 'Correct equation with the equilibrium arrow', points: 1 },
      { criterion: 'Names ethyl ethanoate', points: 1 },
      { criterion: 'Gives a rate factor and explains it does not shift equilibrium', points: 1.5 },
      { criterion: 'Gives a yield factor justified by Le Chatelier', points: 1.5 },
    ],
  },
  {
    chapter: 'Functional Groups',
    subject: 'Chemistry',
    questionType: 'mcq',
    difficulty: 0.3,
    contentText: 'Which functional group characterises CH₃—CO—CH₃?',
    options: [
      { id: 'a', text: 'Aldehyde' },
      { id: 'b', text: 'Ketone' },
      { id: 'c', text: 'Carboxylic acid' },
      { id: 'd', text: 'Ester' },
    ],
    correctOptionId: 'b',
    officialSolution:
      'The carbonyl carbon is bonded to two other carbon atoms, which defines a ketone (propanone). In an aldehyde the carbonyl carbon carries at least one hydrogen.',
  },

  // ========================== PHYSICS ==========================
  {
    chapter: 'Mechanical Oscillations',
    subject: 'Physics',
    questionType: 'open',
    difficulty: 0.55,
    contentText:
      'A mass–spring oscillator of mass m = 0.20 kg and stiffness k = 20 N·m⁻¹ oscillates horizontally without friction.\n\n1. Establish the differential equation of motion.\n2. Deduce the proper period and compute it.',
    officialSolution:
      '1. The only horizontal force is the restoring force of the spring, −kx. Newton’s second law gives m·ẍ = −k·x, that is ẍ + (k/m)·x = 0.\n\n2. This is a simple harmonic oscillator with ω₀² = k/m, so T₀ = 2π√(m/k) = 2π√(0.20/20) = 2π × 0.1 ≈ 0.63 s.',
    bareme: [
      { criterion: 'Identifies the restoring force −kx', points: 1 },
      { criterion: 'Writes ẍ + (k/m)x = 0', points: 1.5 },
      { criterion: 'Gives T₀ = 2π√(m/k)', points: 1 },
      { criterion: 'Computes T₀ ≈ 0.63 s with units', points: 1 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 0 },
  },
  {
    chapter: 'Radioactivity',
    subject: 'Physics',
    questionType: 'open',
    difficulty: 0.5,
    contentText:
      'A sample contains N₀ = 8.0 × 10¹⁰ nuclei of a radioactive isotope of half-life 5.0 days.\n\n1. Define the half-life.\n2. Determine the number of nuclei left after 15 days.\n3. Deduce the radioactive constant λ.',
    officialSolution:
      '1. The half-life T is the time after which half the radioactive nuclei initially present have disintegrated.\n\n2. 15 days is exactly three half-lives, so N = N₀/2³ = 8.0×10¹⁰ / 8 = 1.0×10¹⁰ nuclei.\n\n3. λ = ln2 / T = 0.693 / 5.0 = 0.139 day⁻¹, about 1.6×10⁻⁶ s⁻¹.',
    bareme: [
      { criterion: 'Correct definition of half-life', points: 1 },
      { criterion: 'Recognises 15 days as three half-lives', points: 1 },
      { criterion: 'Computes N = 1.0×10¹⁰ nuclei', points: 1 },
      { criterion: 'Uses λ = ln2 / T and computes it with units', points: 1 },
    ],
  },
  {
    chapter: 'Electromagnetic Induction',
    subject: 'Physics',
    questionType: 'mcq',
    difficulty: 0.45,
    contentText: 'A magnet is pushed towards a coil connected to a galvanometer. The induced current:',
    options: [
      { id: 'a', text: 'Flows so that the coil attracts the magnet' },
      { id: 'b', text: 'Flows so that the coil opposes the approach of the magnet' },
      { id: 'c', text: 'Is zero, because the circuit contains no generator' },
      { id: 'd', text: 'Depends only on the strength of the magnet, not on its motion' },
    ],
    correctOptionId: 'b',
    officialSolution:
      'By Lenz’s law the induced current opposes the cause that produced it, so the coil presents a like pole to the approaching magnet and repels it. This follows from energy conservation: work must be done to push the magnet in.',
  },
  {
    chapter: 'Energy',
    subject: 'Physics',
    questionType: 'problem',
    difficulty: 0.6,
    contentText:
      'A block of mass m = 2.0 kg slides from rest down a frictionless incline of angle α = 30°, through a distance d = 4.0 m along the slope. Take g = 10 m·s⁻².\n\n1. Determine the work done by the weight over this displacement.\n2. Using the work–energy theorem, determine the speed at the bottom.',
    officialSolution:
      '1. Only the component of the weight along the displacement does work: W = mg·sin α · d = 2.0 × 10 × 0.5 × 4.0 = 40 J. The normal reaction is perpendicular to the displacement and does no work.\n\n2. The work–energy theorem gives ΔKE = ΣW, so ½mv² − 0 = 40 J. Hence v² = 2 × 40 / 2.0 = 40 and v = 6.3 m·s⁻¹.',
    bareme: [
      { criterion: 'Identifies that the normal reaction does no work', points: 1 },
      { criterion: 'Uses W = mg·sin α·d', points: 1.5 },
      { criterion: 'Computes W = 40 J with units', points: 1 },
      { criterion: 'States the work–energy theorem', points: 1 },
      { criterion: 'Computes v ≈ 6.3 m·s⁻¹ with units', points: 1.5 },
    ],
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
 * What the tutor may answer from when no past question matches closely enough.
 * Without it tier 2 can never fire and every conceptual question is refused,
 * which makes for a very short demo.
 */
export const DEMO_CONTENT_CHUNKS: DemoContentChunk[] = [
  {
    chapter: 'Transmission of genes and genetic recombination',
    subject: 'Life Sciences',
    kind: 'method',
    title: 'Reading a test cross',
    contentText:
      'In a test cross the double heterozygote is crossed with a doubly recessive individual, which produces one gamete type only. The offspring proportions therefore read directly as the gamete proportions of the heterozygote. Four equal classes mean the genes are independent; two large parental classes and two small recombinant classes mean they are linked, and the percentage of recombinants gives the distance between the loci in centimorgans.',
  },
  {
    chapter: 'The immune response',
    subject: 'Life Sciences',
    kind: 'definition',
    title: 'Primary and secondary responses',
    contentText:
      'The primary response follows a first encounter with an antigen: slow (about ten days), of low intensity, producing effector cells and memory lymphocytes. The secondary response follows a later encounter with the same antigen: memory cells are already selected and numerous, so it is faster (two to three days), far more intense and longer lasting.',
  },
  {
    chapter: 'Function of neurons',
    subject: 'Life Sciences',
    kind: 'definition',
    title: 'The all-or-none law and frequency coding',
    contentText:
      'Below the threshold intensity no action potential is generated. At or above it the action potential always has the same amplitude whatever the stimulus strength. Along a single fibre the intensity of a stimulus is therefore coded by the frequency of action potentials, limited by the refractory period; across a whole nerve it is additionally coded by the number of fibres recruited.',
  },
  {
    chapter: 'Regulation of the female sexual hormones',
    subject: 'Life Sciences',
    kind: 'definition',
    title: 'Negative and positive feedback across the cycle',
    contentText:
      'Through most of the follicular phase, oestradiol at low and moderate concentration inhibits the hypothalamus and the pituitary — negative feedback. At the end of the follicular phase the dominant follicle secretes far more oestradiol; once it passes a threshold and is maintained there for about 36 hours, the feedback reverses and becomes positive, and the pituitary answers with the LH peak that triggers ovulation. The duration above threshold matters as much as the level.',
  },
  {
    chapter: 'Regulation of glycemia',
    subject: 'Life Sciences',
    kind: 'definition',
    title: 'Insulin and glucagon',
    contentText:
      'Insulin is secreted by the β cells of the islets of Langerhans when blood glucose rises. It increases glucose uptake by cells and stimulates glycogenesis in liver and muscle, lowering blood glucose. Glucagon, secreted by the α cells when blood glucose falls, has the antagonistic effect: it stimulates glycogenolysis and gluconeogenesis in the liver, raising blood glucose.',
  },
  {
    chapter: 'Methods of integration',
    subject: 'Mathematics',
    kind: 'method',
    title: 'Integration by substitution',
    contentText:
      'To compute ∫ f(g(x))·g′(x) dx, set u = g(x) so that du = g′(x) dx. Rewrite the integral entirely in u, and convert the limits as well when the integral is definite: the new limits are g(a) and g(b). Forgetting to convert the limits is the commonest error, and it is invisible when the limits happen to be 0 and 1.',
  },
  {
    chapter: 'Exponential functions',
    subject: 'Mathematics',
    kind: 'formula',
    title: 'Derivative of a product involving eˣ',
    contentText:
      'If f(x) = u(x)·e^x then f′(x) = (u(x) + u′(x))·e^x. Since e^x > 0 for all real x, the sign of f′ is the sign of u(x) + u′(x), which is where the study of variations begins.',
  },
  {
    chapter: 'Conditional probability',
    subject: 'Mathematics',
    kind: 'theorem',
    title: 'Law of total probability and conditional probability',
    contentText:
      'If A and its complement Ā partition the universe, then P(B) = P(A)·P(B|A) + P(Ā)·P(B|Ā), and P(A|B) = P(A ∩ B)/P(B). For a rare event A, P(A|B) can be small even when P(B|A) is close to 1, because the false positives drawn from the large complement dominate.',
  },
  {
    chapter: 'Kinetic Factors',
    subject: 'Chemistry',
    kind: 'definition',
    title: 'The kinetic factors',
    contentText:
      'The rate of a reaction increases with temperature (particles collide more often and more energetically), with the concentration of the reactants, and with the surface area of a solid reactant. A catalyst increases the rate by offering a path of lower activation energy, without being consumed and without moving the position of equilibrium.',
  },
  {
    chapter: 'Chemical Equilibrium',
    subject: 'Chemistry',
    kind: 'theorem',
    title: 'Le Chatelier’s principle',
    contentText:
      'When a constraint is imposed on a system at equilibrium, the system evolves in the direction that opposes that constraint. Raising the temperature favours the endothermic direction; raising the pressure favours the side with fewer moles of gas; removing a product favours the forward reaction.',
  },
  {
    chapter: 'Reaction between a weak acid and a strong base',
    subject: 'Chemistry',
    kind: 'method',
    title: 'Exploiting the equivalence point',
    contentText:
      'At equivalence the reactants have been mixed in stoichiometric proportions, so n(acid) = n(base) for a one-to-one reaction. From the volume of titrant, n = C·V gives the amount and dividing by the sample volume gives the unknown concentration. The pH at equivalence is above 7 when a weak acid is titrated by a strong base, because the conjugate base formed reacts with water.',
  },
  {
    chapter: 'Mechanical Oscillations',
    subject: 'Physics',
    kind: 'formula',
    title: 'Proper period of a mass–spring oscillator',
    contentText:
      'For a horizontal mass–spring system without friction, m·ẍ + k·x = 0, so ω₀ = √(k/m) and T₀ = 2π√(m/k). The period depends on the mass and the stiffness only, not on the amplitude — which is what makes the oscillator isochronous.',
  },
  {
    chapter: 'Radioactivity',
    subject: 'Physics',
    kind: 'formula',
    title: 'Decay law and half-life',
    contentText:
      'The number of surviving nuclei follows N(t) = N₀·e^{−λt}. The half-life T is defined by N(T) = N₀/2, giving T = ln2/λ. After n half-lives N = N₀/2ⁿ, which is the fastest route when the elapsed time is a whole number of half-lives.',
  },
  {
    chapter: 'Energy',
    subject: 'Physics',
    kind: 'theorem',
    title: 'The work–energy theorem',
    contentText:
      'The change in kinetic energy of a body between two instants equals the sum of the works of all the forces applied to it: ΔKE = ΣW. A force perpendicular to the displacement — the normal reaction on an incline, for instance — does no work and drops out of the sum.',
  },
];
