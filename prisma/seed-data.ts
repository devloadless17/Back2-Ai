/**
 * PLACEHOLDER CURRICULUM CONTENT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything in this file is structurally real but pedagogically provisional.
 * The taxonomy (tracks, subjects, units, chapters) follows the Lebanese
 * Baccalaureate programme closely enough to build and test against; the
 * questions, solutions, barèmes and course material are written for this
 * repository and are NOT official ministry content.
 *
 * When the real corpus arrives it is loaded through scripts/ingest.ts, which
 * writes to the same tables. This file exists so no screen is dead before then.
 * Delete it, or stop calling it from seed.ts, once real content is ingested.
 *
 * Chapter and subject NAMES should be confirmed against official programme
 * documents before any pilot — they are transcribed here from public syllabus
 * outlines, not from a ministry source.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type SeedChapter = { name: string; unit: string };

export type SeedSubject = {
  name: string;
  language: 'fr' | 'en' | 'ar';
  units: string[];
  chapters: SeedChapter[];
};

export type SeedTrack = {
  code: string;
  name: string;
  subjects: SeedSubject[];
};

export const TRACKS: SeedTrack[] = [
  {
    code: 'GS',
    name: 'Sciences Générales',
    subjects: [
      {
        name: 'Mathématiques',
        language: 'fr',
        units: ['Analyse', 'Algèbre et géométrie', 'Probabilités et statistiques'],
        chapters: [
          { name: 'Suites numériques', unit: 'Analyse' },
          { name: 'Limites et continuité', unit: 'Analyse' },
          { name: 'Dérivation et étude de fonctions', unit: 'Analyse' },
          { name: 'Fonction logarithme népérien', unit: 'Analyse' },
          { name: 'Fonction exponentielle', unit: 'Analyse' },
          { name: 'Calcul intégral', unit: 'Analyse' },
          { name: 'Équations différentielles', unit: 'Analyse' },
          { name: 'Nombres complexes', unit: 'Algèbre et géométrie' },
          { name: 'Géométrie dans l’espace', unit: 'Algèbre et géométrie' },
          { name: 'Probabilités conditionnelles', unit: 'Probabilités et statistiques' },
          { name: 'Lois de probabilité', unit: 'Probabilités et statistiques' },
        ],
      },
      {
        name: 'Physique',
        language: 'fr',
        units: ['Mécanique', 'Électricité', 'Ondes et physique moderne'],
        chapters: [
          { name: 'Cinématique du point', unit: 'Mécanique' },
          { name: 'Lois de Newton', unit: 'Mécanique' },
          { name: 'Énergie mécanique', unit: 'Mécanique' },
          { name: 'Oscillateur mécanique', unit: 'Mécanique' },
          { name: 'Circuit RC', unit: 'Électricité' },
          { name: 'Circuit RL', unit: 'Électricité' },
          { name: 'Circuit RLC et oscillations électriques', unit: 'Électricité' },
          { name: 'Ondes mécaniques', unit: 'Ondes et physique moderne' },
          { name: 'Effet photoélectrique', unit: 'Ondes et physique moderne' },
          { name: 'Radioactivité et noyaux', unit: 'Ondes et physique moderne' },
        ],
      },
      {
        name: 'Chimie',
        language: 'fr',
        units: ['Cinétique et équilibres', 'Chimie organique'],
        chapters: [
          { name: 'Cinétique chimique', unit: 'Cinétique et équilibres' },
          { name: 'Équilibre chimique', unit: 'Cinétique et équilibres' },
          { name: 'Acides et bases', unit: 'Cinétique et équilibres' },
          { name: 'Titrage acido-basique', unit: 'Cinétique et équilibres' },
          { name: 'Alcools et dérivés', unit: 'Chimie organique' },
          { name: 'Acides carboxyliques et esters', unit: 'Chimie organique' },
        ],
      },
    ],
  },
  {
    code: 'LS',
    name: 'Sciences de la Vie',
    subjects: [
      {
        name: 'Sciences de la Vie',
        language: 'fr',
        units: ['Génétique', 'Immunologie', 'Neurophysiologie'],
        chapters: [
          { name: 'Réplication et transcription', unit: 'Génétique' },
          { name: 'Traduction et code génétique', unit: 'Génétique' },
          { name: 'Mutations et variabilité', unit: 'Génétique' },
          { name: 'Génie génétique', unit: 'Génétique' },
          { name: 'Réponse immunitaire innée', unit: 'Immunologie' },
          { name: 'Réponse immunitaire adaptative', unit: 'Immunologie' },
          { name: 'Message nerveux', unit: 'Neurophysiologie' },
          { name: 'Synapse et neurotransmetteurs', unit: 'Neurophysiologie' },
        ],
      },
      {
        name: 'Mathématiques',
        language: 'fr',
        units: ['Analyse', 'Probabilités et statistiques'],
        chapters: [
          { name: 'Suites numériques', unit: 'Analyse' },
          { name: 'Étude de fonctions', unit: 'Analyse' },
          { name: 'Calcul intégral', unit: 'Analyse' },
          { name: 'Probabilités conditionnelles', unit: 'Probabilités et statistiques' },
          { name: 'Statistiques à deux variables', unit: 'Probabilités et statistiques' },
        ],
      },
    ],
  },
  {
    code: 'SE',
    name: 'Sociologie et Économie',
    subjects: [
      {
        name: 'Économie',
        language: 'fr',
        units: ['Macroéconomie', 'Microéconomie'],
        chapters: [
          { name: 'Croissance et développement', unit: 'Macroéconomie' },
          { name: 'Inflation et chômage', unit: 'Macroéconomie' },
          { name: 'Commerce international', unit: 'Macroéconomie' },
          { name: 'Offre et demande', unit: 'Microéconomie' },
          { name: 'Structures de marché', unit: 'Microéconomie' },
        ],
      },
      {
        name: 'Sociologie',
        language: 'fr',
        units: ['Structures sociales'],
        chapters: [
          { name: 'Stratification sociale', unit: 'Structures sociales' },
          { name: 'Mobilité sociale', unit: 'Structures sociales' },
          { name: 'Socialisation', unit: 'Structures sociales' },
        ],
      },
    ],
  },
  {
    code: 'LH',
    name: 'Lettres et Humanités',
    subjects: [
      {
        name: 'Philosophie',
        language: 'fr',
        units: ['Philosophie générale'],
        chapters: [
          { name: 'La conscience et l’inconscient', unit: 'Philosophie générale' },
          { name: 'La liberté', unit: 'Philosophie générale' },
          { name: 'La vérité et la connaissance', unit: 'Philosophie générale' },
          { name: 'L’État et la justice', unit: 'Philosophie générale' },
        ],
      },
      {
        name: 'اللغة العربية',
        language: 'ar',
        units: ['النصوص والتحليل'],
        chapters: [
          { name: 'تحليل النص الأدبي', unit: 'النصوص والتحليل' },
          { name: 'الشعر الحديث', unit: 'النصوص والتحليل' },
          { name: 'المقالة', unit: 'النصوص والتحليل' },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export type SeedQuestion = {
  /** Matches a chapter name defined above. */
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
  /** When set, the question is attached to that exam cycle at this position. */
  cycle?: { year: number; session: string; orderIndex: number };
};

export const QUESTIONS: SeedQuestion[] = [
  // --- Mathématiques : Suites numériques ---
  {
    chapter: 'Suites numériques',
    subject: 'Mathématiques',
    questionType: 'mcq',
    difficulty: 0.3,
    contentText:
      'Soit la suite (u_n) définie par u_0 = 3 et u_{n+1} = 2u_n - 1 pour tout n ≥ 0. Que vaut u_3 ?',
    contentLatex:
      'Soit la suite $(u_n)$ définie par $u_0 = 3$ et $u_{n+1} = 2u_n - 1$ pour tout $n \\geq 0$. Que vaut $u_3$ ?',
    options: [
      { id: 'a', text: '11' },
      { id: 'b', text: '17' },
      { id: 'c', text: '15' },
      { id: 'd', text: '9' },
    ],
    correctOptionId: 'b',
    officialSolution:
      'u_1 = 2(3) - 1 = 5 ; u_2 = 2(5) - 1 = 9 ; u_3 = 2(9) - 1 = 17. La réponse est 17.',
  },
  {
    chapter: 'Suites numériques',
    subject: 'Mathématiques',
    questionType: 'problem',
    difficulty: 0.6,
    contentText:
      'Soit (u_n) définie par u_0 = 3 et u_{n+1} = 2u_n - 1. On pose v_n = u_n - 1.\n' +
      '1) Montrer que (v_n) est géométrique et préciser sa raison.\n' +
      '2) Exprimer v_n puis u_n en fonction de n.\n' +
      '3) Déterminer la limite de (u_n).',
    contentLatex:
      'Soit $(u_n)$ définie par $u_0 = 3$ et $u_{n+1} = 2u_n - 1$. On pose $v_n = u_n - 1$.\n\n' +
      '1) Montrer que $(v_n)$ est géométrique et préciser sa raison.\n\n' +
      '2) Exprimer $v_n$ puis $u_n$ en fonction de $n$.\n\n' +
      '3) Déterminer $\\lim_{n \\to +\\infty} u_n$.',
    officialSolution:
      '1) v_{n+1} = u_{n+1} - 1 = 2u_n - 2 = 2(u_n - 1) = 2v_n. Donc (v_n) est géométrique de raison q = 2, ' +
      'de premier terme v_0 = u_0 - 1 = 2.\n' +
      '2) v_n = 2 × 2^n = 2^{n+1}, donc u_n = 2^{n+1} + 1.\n' +
      '3) Comme 2 > 1, 2^{n+1} → +∞, donc u_n → +∞.',
    bareme: [
      { criterion: 'Calcul de v_{n+1} en fonction de v_n', points: 2 },
      { criterion: 'Conclusion que (v_n) est géométrique de raison 2', points: 1 },
      { criterion: 'Identification du premier terme v_0 = 2', points: 1 },
      { criterion: 'Expression de v_n en fonction de n', points: 2 },
      { criterion: 'Expression de u_n en fonction de n', points: 2 },
      { criterion: 'Détermination correcte de la limite avec justification', points: 2 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 1 },
  },
  // --- Mathématiques : Fonction exponentielle ---
  {
    chapter: 'Fonction exponentielle',
    subject: 'Mathématiques',
    questionType: 'problem',
    difficulty: 0.7,
    contentText:
      'Soit f la fonction définie sur ℝ par f(x) = (x - 2)e^x.\n' +
      '1) Calculer les limites de f en -∞ et en +∞.\n' +
      '2) Étudier les variations de f et dresser son tableau de variations.\n' +
      '3) Déterminer une équation de la tangente à la courbe de f au point d’abscisse 0.',
    contentLatex:
      'Soit $f$ la fonction définie sur $\\mathbb{R}$ par $f(x) = (x - 2)e^x$.\n\n' +
      '1) Calculer $\\lim_{x \\to -\\infty} f(x)$ et $\\lim_{x \\to +\\infty} f(x)$.\n\n' +
      '2) Étudier les variations de $f$ et dresser son tableau de variations.\n\n' +
      '3) Déterminer une équation de la tangente à $\\mathcal{C}_f$ au point d’abscisse $0$.',
    officialSolution:
      '1) En -∞ : x - 2 → -∞ et e^x → 0. Par croissances comparées, f(x) → 0^-. En +∞ : f(x) → +∞.\n' +
      '2) f’(x) = e^x + (x - 2)e^x = (x - 1)e^x. Comme e^x > 0, le signe de f’ est celui de (x - 1). ' +
      'f est décroissante sur ]-∞ ; 1] et croissante sur [1 ; +∞[, avec un minimum f(1) = -e.\n' +
      '3) f(0) = -2 et f’(0) = -1, donc la tangente a pour équation y = -x - 2.',
    bareme: [
      { criterion: 'Limite en -∞ avec justification par croissances comparées', points: 2 },
      { criterion: 'Limite en +∞', points: 1 },
      { criterion: 'Calcul correct de la dérivée f’(x) = (x - 1)e^x', points: 2 },
      { criterion: 'Étude du signe de la dérivée', points: 1.5 },
      { criterion: 'Tableau de variations complet avec le minimum', points: 1.5 },
      { criterion: 'Équation de la tangente y = -x - 2', points: 2 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 2 },
  },
  {
    chapter: 'Fonction exponentielle',
    subject: 'Mathématiques',
    questionType: 'mcq',
    difficulty: 0.35,
    contentText: 'Quelle est la dérivée de la fonction g définie par g(x) = e^{3x + 1} ?',
    contentLatex: 'Quelle est la dérivée de $g(x) = e^{3x + 1}$ ?',
    options: [
      { id: 'a', text: 'e^{3x+1}' },
      { id: 'b', text: '3e^{3x+1}' },
      { id: 'c', text: '(3x+1)e^{3x}' },
      { id: 'd', text: '3e^{3x}' },
    ],
    correctOptionId: 'b',
    officialSolution:
      'Si g(x) = e^{u(x)} alors g’(x) = u’(x)e^{u(x)}. Ici u(x) = 3x + 1 donc u’(x) = 3, ' +
      'et g’(x) = 3e^{3x+1}.',
  },
  // --- Mathématiques : Nombres complexes ---
  {
    chapter: 'Nombres complexes',
    subject: 'Mathématiques',
    questionType: 'problem',
    difficulty: 0.65,
    contentText:
      'Soit z = 1 + i√3.\n1) Écrire z sous forme trigonométrique.\n2) En déduire z^6.',
    contentLatex:
      'Soit $z = 1 + i\\sqrt{3}$.\n\n1) Écrire $z$ sous forme trigonométrique.\n\n2) En déduire $z^6$.',
    officialSolution:
      '1) |z| = √(1 + 3) = 2. Un argument θ vérifie cos θ = 1/2 et sin θ = √3/2, donc θ = π/3. ' +
      'Ainsi z = 2(cos(π/3) + i sin(π/3)).\n' +
      '2) Par la formule de Moivre, z^6 = 2^6 (cos(2π) + i sin(2π)) = 64.',
    bareme: [
      { criterion: 'Calcul correct du module |z| = 2', points: 2 },
      { criterion: 'Détermination correcte de l’argument π/3', points: 2 },
      { criterion: 'Écriture trigonométrique complète', points: 1 },
      { criterion: 'Application de la formule de Moivre', points: 2 },
      { criterion: 'Résultat final z^6 = 64', points: 1 },
    ],
  },
  // --- Physique : Circuit RC ---
  {
    chapter: 'Circuit RC',
    subject: 'Physique',
    questionType: 'problem',
    difficulty: 0.55,
    contentText:
      'Un condensateur de capacité C = 10 µF, initialement déchargé, est chargé à travers un ' +
      'conducteur ohmique de résistance R = 2 kΩ par un générateur de f.é.m. E = 6 V.\n' +
      '1) Établir l’équation différentielle vérifiée par la tension u_C aux bornes du condensateur.\n' +
      '2) Donner l’expression de u_C(t).\n' +
      '3) Calculer la constante de temps τ et le temps nécessaire pour atteindre 99 % de E.',
    officialSolution:
      '1) Loi des mailles : E = R i + u_C avec i = C du_C/dt, d’où RC du_C/dt + u_C = E.\n' +
      '2) u_C(t) = E(1 - e^{-t/RC}) = 6(1 - e^{-t/0,02}) V.\n' +
      '3) τ = RC = 2000 × 10×10^{-6} = 0,02 s. À 99 %, t ≈ 5τ = 0,1 s.',
    bareme: [
      { criterion: 'Loi des mailles correctement écrite', points: 1.5 },
      { criterion: 'Relation i = C du_C/dt utilisée', points: 1.5 },
      { criterion: 'Équation différentielle correcte', points: 1 },
      { criterion: 'Expression de u_C(t) avec la bonne condition initiale', points: 2 },
      { criterion: 'Calcul de τ avec unité correcte', points: 1 },
      { criterion: 'Temps à 99 % estimé à 5τ', points: 1 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 1 },
  },
  {
    chapter: 'Circuit RC',
    subject: 'Physique',
    questionType: 'mcq',
    difficulty: 0.25,
    contentText: 'Quelle est l’unité de la constante de temps τ = RC ?',
    options: [
      { id: 'a', text: 'Le farad (F)' },
      { id: 'b', text: 'La seconde (s)' },
      { id: 'c', text: "L'ohm (Ω)" },
      { id: 'd', text: 'Le volt (V)' },
    ],
    correctOptionId: 'b',
    officialSolution:
      'τ = RC a la dimension d’un temps : [Ω] × [F] = [V/A] × [C/V] = [C/A] = [s]. C’est une seconde.',
  },
  // --- Physique : Lois de Newton ---
  {
    chapter: 'Lois de Newton',
    subject: 'Physique',
    questionType: 'problem',
    difficulty: 0.6,
    contentText:
      'Un solide de masse m = 2 kg glisse sans vitesse initiale sur un plan incliné d’un angle ' +
      'α = 30° par rapport à l’horizontale. Les frottements sont modélisés par une force f = 3 N ' +
      'opposée au mouvement. On prend g = 10 m·s⁻².\n' +
      '1) Faire le bilan des forces et représenter ces forces.\n' +
      '2) Appliquer la deuxième loi de Newton et déterminer l’accélération.\n' +
      '3) Calculer la vitesse après 2 s de mouvement.',
    officialSolution:
      '1) Trois forces : le poids P⃗ (vertical, vers le bas, P = mg = 20 N), la réaction normale ' +
      'R⃗ (perpendiculaire au plan) et la force de frottement f⃗ (parallèle au plan, opposée au mouvement).\n' +
      '2) Projection sur l’axe du mouvement : mg sin α - f = ma, donc a = (20 × 0,5 - 3)/2 = 3,5 m·s⁻².\n' +
      '3) v = a t = 3,5 × 2 = 7 m·s⁻¹.',
    bareme: [
      { criterion: 'Bilan des forces complet (poids, réaction normale, frottement)', points: 2 },
      { criterion: 'Schéma ou description cohérente des directions', points: 1 },
      { criterion: 'Application de la deuxième loi de Newton', points: 1.5 },
      { criterion: 'Projection correcte sur l’axe du mouvement', points: 1.5 },
      { criterion: 'Valeur numérique de l’accélération avec unité', points: 2 },
      { criterion: 'Calcul de la vitesse à t = 2 s', points: 2 },
    ],
  },
  // --- Chimie ---
  {
    chapter: 'Titrage acido-basique',
    subject: 'Chimie',
    questionType: 'problem',
    difficulty: 0.5,
    contentText:
      'On titre V_A = 20,0 mL d’une solution d’acide chlorhydrique de concentration C_A inconnue ' +
      'par une solution d’hydroxyde de sodium de concentration C_B = 0,10 mol·L⁻¹. ' +
      'L’équivalence est atteinte pour V_B = 16,0 mL.\n' +
      '1) Écrire l’équation de la réaction de titrage.\n' +
      '2) Déterminer C_A.\n' +
      '3) Indiquer la valeur attendue du pH à l’équivalence en justifiant.',
    officialSolution:
      '1) H₃O⁺ + HO⁻ → 2 H₂O.\n' +
      '2) À l’équivalence : C_A V_A = C_B V_B, donc C_A = (0,10 × 16,0)/20,0 = 0,080 mol·L⁻¹.\n' +
      '3) Le titrage oppose un acide fort à une base forte ; l’espèce formée (NaCl) est neutre, ' +
      'donc pH = 7 à 25 °C.',
    bareme: [
      { criterion: 'Équation de titrage correcte', points: 2 },
      { criterion: 'Relation à l’équivalence C_A V_A = C_B V_B', points: 2 },
      { criterion: 'Valeur numérique de C_A avec unité et chiffres significatifs', points: 2 },
      { criterion: 'pH = 7 à l’équivalence', points: 1 },
      { criterion: 'Justification par la nature acide fort / base forte', points: 1 },
    ],
  },
  // --- Sciences de la Vie ---
  {
    chapter: 'Réponse immunitaire adaptative',
    subject: 'Sciences de la Vie',
    questionType: 'open',
    difficulty: 0.55,
    contentText:
      'Expliquer le rôle des lymphocytes T auxiliaires (LT4) dans le déclenchement de la réponse ' +
      'immunitaire adaptative, en précisant leurs interactions avec les autres cellules impliquées.',
    officialSolution:
      'Les LT4 reconnaissent l’antigène présenté par les cellules présentatrices d’antigène (CPA) ' +
      'via le complexe CMH-II. Cette reconnaissance, associée à un signal de co-stimulation, active le LT4 ' +
      'qui prolifère et sécrète des interleukines. Ces interleukines stimulent la prolifération et la ' +
      'différenciation des lymphocytes B en plasmocytes producteurs d’anticorps, ainsi que celles des ' +
      'lymphocytes T cytotoxiques. Les LT4 jouent donc un rôle central de coordination : sans eux, ' +
      'les deux voies de la réponse adaptative sont fortement diminuées.',
    bareme: [
      { criterion: 'Reconnaissance de l’antigène présenté par la CPA via le CMH-II', points: 2 },
      { criterion: 'Mention de l’activation et de la prolifération du LT4', points: 1.5 },
      { criterion: 'Sécrétion d’interleukines identifiée', points: 1.5 },
      { criterion: 'Action sur les lymphocytes B et la production d’anticorps', points: 2 },
      { criterion: 'Action sur les lymphocytes T cytotoxiques', points: 1.5 },
      { criterion: 'Conclusion sur le rôle coordinateur du LT4', points: 1.5 },
    ],
    cycle: { year: 2023, session: 'session1', orderIndex: 1 },
  },
  {
    chapter: 'Traduction et code génétique',
    subject: 'Sciences de la Vie',
    questionType: 'mcq',
    difficulty: 0.3,
    contentText: 'Combien de nucléotides constituent un codon ?',
    options: [
      { id: 'a', text: 'Deux' },
      { id: 'b', text: 'Trois' },
      { id: 'c', text: 'Quatre' },
      { id: 'd', text: 'Cela dépend de l’acide aminé' },
    ],
    correctOptionId: 'b',
    officialSolution:
      'Le code génétique est un code à triplets : chaque codon est constitué de trois nucléotides ' +
      'consécutifs de l’ARN messager, ce qui donne 4³ = 64 codons possibles.',
  },
  // --- Économie ---
  {
    chapter: 'Inflation et chômage',
    subject: 'Économie',
    questionType: 'open',
    difficulty: 0.5,
    contentText:
      'Présenter la relation décrite par la courbe de Phillips, puis expliquer pourquoi cette relation ' +
      'a été remise en question à partir des années 1970.',
    officialSolution:
      'La courbe de Phillips décrit une relation inverse de court terme entre le taux de chômage et le ' +
      'taux d’inflation : une baisse du chômage s’accompagne d’une hausse des salaires puis ' +
      'des prix. À partir des années 1970, la stagflation — chômage et inflation élevés simultanément — ' +
      'a contredit cette relation. L’explication avancée fait intervenir les anticipations : lorsque ' +
      'les agents anticipent l’inflation, ils l’intègrent dans leurs revendications salariales, ' +
      'de sorte que la relation ne tient plus à long terme.',
    bareme: [
      { criterion: 'Énoncé de la relation inverse chômage / inflation', points: 2 },
      { criterion: 'Mécanisme salaires-prix expliqué', points: 2 },
      { criterion: 'Référence à la stagflation des années 1970', points: 2 },
      { criterion: 'Rôle des anticipations d’inflation', points: 2 },
    ],
  },
  // --- Philosophie ---
  {
    chapter: 'La liberté',
    subject: 'Philosophie',
    questionType: 'open',
    difficulty: 0.7,
    contentText: 'Être libre, est-ce faire ce que l’on veut ?',
    officialSolution:
      'Le sujet oppose une conception spontanée de la liberté — l’absence d’obstacle au désir — ' +
      'à une conception réflexive. On peut montrer d’abord que faire ce que l’on veut définit une ' +
      'liberté d’indifférence, puis objecter que le désir lui-même peut être déterminé (habitudes, ' +
      'passions, conditionnement social), de sorte que satisfaire ses désirs peut être une forme de ' +
      'servitude. On aboutit à une liberté comprise comme autonomie : se donner à soi-même sa propre loi.',
    bareme: [
      { criterion: 'Problématisation explicite du sujet', points: 3 },
      { criterion: 'Thèse initiale : liberté comme absence de contrainte', points: 3 },
      { criterion: 'Objection : le désir peut être déterminé', points: 4 },
      { criterion: 'Dépassement : liberté comme autonomie', points: 4 },
      { criterion: 'Rigueur de l’argumentation et des références', points: 3 },
      { criterion: 'Qualité de l’expression et de la conclusion', points: 3 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Course material — the tier-2 retrieval corpus
// ---------------------------------------------------------------------------

export type SeedContentChunk = {
  chapter: string;
  subject: string;
  kind: 'definition' | 'formula' | 'theorem' | 'method' | 'worked_example';
  title: string;
  contentText: string;
};

export const CONTENT_CHUNKS: SeedContentChunk[] = [
  {
    chapter: 'Suites numériques',
    subject: 'Mathématiques',
    kind: 'definition',
    title: 'Suite géométrique',
    contentText:
      'Une suite (v_n) est géométrique de raison q lorsque v_{n+1} = q × v_n pour tout n. ' +
      'Son terme général est v_n = v_0 × q^n. Si |q| < 1 la suite converge vers 0 ; ' +
      'si q > 1 et v_0 > 0 elle diverge vers +∞.',
  },
  {
    chapter: 'Suites numériques',
    subject: 'Mathématiques',
    kind: 'method',
    title: 'Montrer qu’une suite auxiliaire est géométrique',
    contentText:
      'Pour une suite définie par u_{n+1} = a u_n + b avec a ≠ 1, on pose v_n = u_n - L où L = b/(1-a) ' +
      'est le point fixe. On calcule alors v_{n+1} = u_{n+1} - L et on factorise pour faire apparaître ' +
      'v_{n+1} = a v_n. On en déduit v_n = v_0 a^n puis u_n = v_n + L.',
  },
  {
    chapter: 'Fonction exponentielle',
    subject: 'Mathématiques',
    kind: 'formula',
    title: 'Dérivées et limites de l’exponentielle',
    contentText:
      '(e^x)’ = e^x ; (e^{u(x)})’ = u’(x) e^{u(x)}. ' +
      'Croissances comparées : lim_{x→+∞} e^x / x^n = +∞ et lim_{x→-∞} x^n e^x = 0 pour tout n. ' +
      'e^x > 0 pour tout réel x, ce qui permet de réduire l’étude du signe d’un produit ' +
      'contenant e^x au signe de l’autre facteur.',
  },
  {
    chapter: 'Fonction exponentielle',
    subject: 'Mathématiques',
    kind: 'method',
    title: 'Étudier les variations d’une fonction du type P(x)e^x',
    contentText:
      'On dérive avec la règle du produit : (P(x)e^x)’ = (P’(x) + P(x))e^x. ' +
      'Comme e^x est strictement positif, le signe de la dérivée est celui de P’(x) + P(x). ' +
      'On résout cette inéquation, puis on dresse le tableau de variations en y reportant les limites aux bornes.',
  },
  {
    chapter: 'Nombres complexes',
    subject: 'Mathématiques',
    kind: 'theorem',
    title: 'Formule de Moivre',
    contentText:
      'Pour tout réel θ et tout entier n : (cos θ + i sin θ)^n = cos(nθ) + i sin(nθ). ' +
      'En écriture trigonométrique, si z = r(cos θ + i sin θ) alors z^n = r^n (cos(nθ) + i sin(nθ)). ' +
      'C’est l’outil standard pour calculer une puissance élevée d’un nombre complexe.',
  },
  {
    chapter: 'Nombres complexes',
    subject: 'Mathématiques',
    kind: 'method',
    title: 'Passer de la forme algébrique à la forme trigonométrique',
    contentText:
      'Pour z = a + ib : on calcule le module r = √(a² + b²), puis on cherche θ tel que ' +
      'cos θ = a/r et sin θ = b/r. Les deux équations sont nécessaires — le seul cosinus laisse ' +
      'une ambiguïté de signe sur l’argument. On écrit ensuite z = r(cos θ + i sin θ).',
  },
  {
    chapter: 'Circuit RC',
    subject: 'Physique',
    kind: 'formula',
    title: 'Charge d’un condensateur',
    contentText:
      'Équation différentielle : RC du_C/dt + u_C = E. Solution avec condensateur initialement déchargé : ' +
      'u_C(t) = E(1 - e^{-t/τ}) avec τ = RC. Le courant vaut i(t) = (E/R)e^{-t/τ}. ' +
      'Après 5τ la charge est complète à 99 %.',
  },
  {
    chapter: 'Circuit RC',
    subject: 'Physique',
    kind: 'method',
    title: 'Établir l’équation différentielle d’un circuit RC',
    contentText:
      'On applique la loi des mailles : E = u_R + u_C. On exprime u_R = R i, puis on utilise ' +
      'la relation de définition du condensateur i = C du_C/dt. En substituant, on obtient ' +
      'RC du_C/dt + u_C = E. Vérifier l’homogénéité : RC est bien un temps.',
  },
  {
    chapter: 'Lois de Newton',
    subject: 'Physique',
    kind: 'method',
    title: 'Résoudre un problème de plan incliné',
    contentText:
      'On choisit un repère avec un axe parallèle au plan et orienté dans le sens du mouvement. ' +
      'On fait le bilan des forces : poids, réaction normale, frottements éventuels. ' +
      'On projette la deuxième loi de Newton sur l’axe du mouvement : mg sin α - f = ma. ' +
      'La projection sur l’axe perpendiculaire donne R = mg cos α.',
  },
  {
    chapter: 'Titrage acido-basique',
    subject: 'Chimie',
    kind: 'method',
    title: 'Exploiter l’équivalence d’un titrage',
    contentText:
      'À l’équivalence, les réactifs sont introduits dans les proportions stœchiométriques. ' +
      'Pour un titrage acide fort / base forte de rapport 1:1, cela donne C_A V_A = C_B V_B. ' +
      'Le pH à l’équivalence vaut 7 pour acide fort / base forte, il est supérieur à 7 pour ' +
      'acide faible / base forte, et inférieur à 7 pour base faible / acide fort.',
  },
  {
    chapter: 'Réponse immunitaire adaptative',
    subject: 'Sciences de la Vie',
    kind: 'definition',
    title: 'Lymphocytes T auxiliaires',
    contentText:
      'Les lymphocytes T auxiliaires (LT4) portent le marqueur CD4 et reconnaissent un antigène ' +
      'présenté par une cellule présentatrice d’antigène via le complexe majeur ' +
      'd’histocompatibilité de classe II. Une fois activés, ils sécrètent des interleukines qui ' +
      'stimulent la prolifération des lymphocytes B et des lymphocytes T cytotoxiques. ' +
      'Ils constituent le pivot de la réponse adaptative.',
  },
  {
    chapter: 'Traduction et code génétique',
    subject: 'Sciences de la Vie',
    kind: 'definition',
    title: 'Codon et code génétique',
    contentText:
      'Un codon est un triplet de nucléotides de l’ARN messager qui code un acide aminé. ' +
      'Le code génétique comporte 64 codons pour 20 acides aminés : il est donc redondant. ' +
      'Il est également universel et non chevauchant. AUG est le codon initiateur ; ' +
      'UAA, UAG et UGA sont les codons stop.',
  },
  {
    chapter: 'Inflation et chômage',
    subject: 'Économie',
    kind: 'definition',
    title: 'Courbe de Phillips',
    contentText:
      'La courbe de Phillips établit une relation inverse de court terme entre le taux de chômage ' +
      'et le taux de croissance des salaires nominaux, donc de l’inflation. ' +
      'La stagflation des années 1970 a invalidé cette relation à long terme ; ' +
      'l’explication retenue repose sur l’intégration des anticipations d’inflation ' +
      'par les agents économiques.',
  },
  {
    chapter: 'La liberté',
    subject: 'Philosophie',
    kind: 'method',
    title: 'Construire une dissertation philosophique',
    contentText:
      'L’introduction dégage le problème à partir d’une tension contenue dans le sujet. ' +
      'Le développement procède en trois moments : une thèse spontanée, une objection qui la met en ' +
      'difficulté, puis un dépassement qui reformule la notion. Chaque partie s’appuie sur un exemple ' +
      'analysé et, si possible, sur une référence philosophique précise. La conclusion répond ' +
      'explicitement à la question posée.',
  },
];

// ---------------------------------------------------------------------------
// Past papers
// ---------------------------------------------------------------------------

export type SeedExamCycle = {
  subject: string;
  trackCode: string;
  year: number;
  session: string;
  title: string;
  durationMinutes: number;
};

export const EXAM_CYCLES: SeedExamCycle[] = [
  { subject: 'Mathématiques', trackCode: 'SG', year: 2023, session: 'session1', title: 'Mathématiques SG — Session 1', durationMinutes: 240 },
  { subject: 'Mathématiques', trackCode: 'SG', year: 2023, session: 'session2', title: 'Mathématiques SG — Session 2', durationMinutes: 240 },
  { subject: 'Mathématiques', trackCode: 'SG', year: 2022, session: 'session1', title: 'Mathématiques SG — Session 1', durationMinutes: 240 },
  { subject: 'Physique', trackCode: 'SG', year: 2023, session: 'session1', title: 'Physique SG — Session 1', durationMinutes: 180 },
  { subject: 'Physique', trackCode: 'SG', year: 2022, session: 'session1', title: 'Physique SG — Session 1', durationMinutes: 180 },
  { subject: 'Chimie', trackCode: 'SG', year: 2023, session: 'session1', title: 'Chimie SG — Session 1', durationMinutes: 120 },
  { subject: 'Sciences de la Vie', trackCode: 'SV', year: 2023, session: 'session1', title: 'Sciences de la Vie SV — Session 1', durationMinutes: 180 },
  { subject: 'Économie', trackCode: 'VSE', year: 2023, session: 'session1', title: 'Économie VSE — Session 1', durationMinutes: 180 },
  { subject: 'Philosophie', trackCode: 'LH', year: 2023, session: 'session1', title: 'Philosophie LH — Session 1', durationMinutes: 180 },
];
