/**
 * Which of the three kinds of question the Lebanese Bac asks — told apart by
 * rule, before retrieval decides what to go looking for.
 *
 * Retrieval sends every question down one path: find the chapter, hand over its
 * passages. That is right for one kind of question and wrong for the other two,
 * and the wrongness is invisible — a comprehension question answered out of a
 * chapter still produces fluent prose with a citation under it.
 *
 * CONCEPT. "ما هي البطالة؟", "Explain the photoelectric effect." The answer is
 * in the textbook, so the chapter is the right thing to find.
 *
 * COMPREHENSION. "Identifiez le référent du pronom « on » dans les deux
 * premiers paragraphes du texte de Lamennais." The answer is in a passage
 * printed on the exam paper. It is in no chapter, so no amount of retrieval
 * quality reaches it, and the chapter that comes back nearest is simply the
 * least wrong one.
 *
 * ESSAY. "اشرح هذا القول", "Sujet : Partagez-vous le point de vue…". There is
 * no fact to retrieve at all. What helps is the shape of a good answer, which
 * the marking scheme states outright.
 *
 * Rules rather than a model, for three reasons: the markers are printed on the
 * papers and are near enough to fixed strings; a rule can be read by the person
 * who has to trust it; and this runs before every retrieval, so a model call
 * here would be a model call on the critical path of every question asked.
 *
 * The one asymmetry that matters is the ordering in `classifyQuestionKind`, and
 * it is deliberate. Mistaking an essay for comprehension, or the reverse, costs
 * a worse answer. Mistaking either for a concept question costs an answer
 * confidently drawn from a chapter that does not contain it, which is the exact
 * failure the tier system exists to prevent and the one nobody can see happen.
 * So concept is reached only when nothing else fired, and a question carrying a
 * deictic its own text does not resolve is flagged unsure rather than assumed.
 */

export type QuestionKind = 'concept' | 'comprehension' | 'essay';

export type QuestionClassification = {
  kind: QuestionKind;
  /**
   * 'low' means no marker decided this and the default was taken over a text
   * that points at something it does not contain ("explique celui-ci"). The
   * retrieval gate is raised on those rather than lowered.
   */
  confidence: 'high' | 'low';
  /** Which marker decided it. Carried for the bench and for logging. */
  signal: string;
};

/*
 * Arabic as a PDF gives it up, versus Arabic as a student types it.
 *
 * Papers extracted from a shaping font arrive with diacritics, tatweel and — on
 * the worst of them — a space between every letter: "اش ر ح هذا الحكم" is one
 * verb, three spaces and a phrase. Alef comes in four forms that a student
 * types interchangeably. None of that survives a plain string comparison, so
 * both sides of every comparison are folded to the same shape first.
 */
const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;

function fold(text: string): string {
  return text
    .normalize('NFKC')
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/[«»“”‘’]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The same text with the spacing a shaping font invented taken back out. */
function despace(text: string): string {
  return text.replace(/\s+/g, '');
}

const phrases = (...list: string[]) => list.map((p) => despace(fold(p)));

/**
 * Arabic markers long enough to be safe as substrings.
 *
 * Letter-spacing noise rules out word boundaries — there are none left to
 * anchor on — so these are matched against the de-spaced text, which means each
 * one has to be a string that cannot turn up inside another word. That is a
 * real constraint, and it is why "النص" is not in this list: it is the first
 * three letters of "النصف", half, which appears in every second maths paper.
 * The short ones are matched with boundaries below instead, at the accepted
 * cost of missing the worst-spaced papers.
 */
const AR_DOCUMENT = phrases(
  'المستند',
  'القصيدة',
  'الابيات',
  'الوثيقة',
  'الفقرة',
  'الرسم البياني',
  'بالعودة الى',
  'في ضوء المستند',
  'النص الاتي',
  'النص التالي',
);

const AR_ESSAY = phrases(
  'الموضوع',
  'اشرح هذا القول',
  'اشرح هذا الحكم',
  'ناقش هذا القول',
  'ناقش هذا الحكم',
  'اشرح هذا الراي',
  'حلل هذا القول',
  // The commentaire de texte: the passage is quoted inside the prompt, and
  // what is asked for is still an essay about it.
  'اشرح هذا النص',
  'ناقش هذا النص',
  'حلل هذا النص',
  'عالج احد',
  'اختر احد',
  'ابد رايك',
  'في ضوء ما تقدم',
  'اكتب مقالة',
  'دافع عن',
  'ناقش',
);

const AR_DEICTIC = phrases('الاتي', 'اعلاه', 'ادناه', 'هذا السؤال', 'هذا التمرين', 'المذكور');

/**
 * The short Arabic nouns, matched where the spacing survived.
 *
 * `\p{Letter}` on either side rather than `\b`, which knows nothing useful
 * about Arabic script.
 */
const AR_SHORT_DOCUMENT =
  /(?<!\p{Letter})(?:النص|النصوص|السطر|الاسطر|البيت|المقطع)(?!\p{Letter})/u;

/**
 * A reference to something printed on the paper and nowhere else.
 *
 * The nouns are the ones that only ever mean "the thing you were handed".
 * `tableau` and `graphique` are deliberately absent: "dans le tableau suivant,
 * une seule des réponses proposées est correcte" opens a Lebanese maths MCQ,
 * and reading that as comprehension would refuse a question its chapter answers
 * perfectly well.
 */
const DOCUMENT_REFERENCE = new RegExp(
  [
    '\\b(?:le|la|les|ce|cet|cette|ces|du|de la|des|au|aux|dans le|d\u2019apr[èe]s le|d\'apr[èe]s le)\\s+' +
      '(?:texte|document|extrait|passage|po[èe]me|paratexte|corpus|caricature|strophe|vers)s?\\b',
    '\\bl[\u2019\'](?:extrait|auteur|article|image)\\b',
    '\\blignes?\\s*\\d',
    '\\bl\\.\\s*\\d',
    '\\bparagraphes?\\b',
    /*
     * English demonstratives, not only the article.
     *
     * The French branch above has taken `ce|cette|ces` since it was written;
     * the English one took only `the`, so "explain this passage" read as a
     * concept question while "explique ce texte" read correctly. The gap was
     * invisible while both kinds ended in the same refusal. It stopped being
     * invisible when comprehension became the one kind NOT answered from
     * general knowledge: a missed marker now means an answer invented about a
     * passage nobody supplied, which is the exact failure the comprehension
     * lane exists to prevent.
     *
     * `your` is here for "your text" / "your extract" — how a student refers to
     * a document they pasted earlier in the thread.
     */
    '\\b(?:the|this|that|these|those|your)\\s+' +
      '(?:text|passage|extract|document|poem|story|paragraph|author)s?\\b',
    /*
     * `article` on its own line, and never plural after a demonstrative.
     *
     * English uses it for both a written piece and a piece of merchandise, and
     * both turn up in this corpus: "The writer in this article highlights the
     * role of leptin" is a comprehension passage, while "These articles are
     * distributed among 30 boxes" is a maths counting problem. Number separates
     * them cleanly on the evidence available — the goods are plural, the
     * passage is singular — so `these|those articles` is left out and the rest
     * kept. Measured over 5,297 corpus questions: with the plural admitted it
     * cost two false comprehensions, without `article` at all it lost three
     * real ones, and this way costs neither.
     */
    '\\b(?:the|this|that)\\s+articles?\\b',
    '\\blines?\\s*\\d',
    '\\baccording to the\\b',
  ].join('|'),
  'iu',
);

/**
 * A prompt that asks for an essay, by the header the paper prints over it.
 *
 * "Sujet :" and "الموضوع" are the paper naming the thing itself. The others are
 * the fixed phrases a Lebanese prompt is built out of — "ce jugement", "cette
 * citation", "la problématique" — preferred over the instruction verbs on
 * purpose, because the verbs are where the extracted text is least reliable:
 * several French papers in this corpus lost every 's' to the PDF layer, so
 * "Discutez" arrives as "Di cutez" while "ce jugement" arrives intact.
 */
const ESSAY_HEADER = new RegExp(
  [
    '\\bsujets?\\s*[:\uFF1A]',
    '\\b(?:premier|premi[èe]re|deuxi[èe]me|troisi[èe]me|quatri[èe]me)\\s+sujet\\b',
    '\\bdissertation\\b',
    '\\bproduction\\s+[ée]crite\\b',
    '\\btopics?\\s*[:\uFF1A]',
    '\\bessay\\b',
  ].join('|'),
  'iu',
);

/**
 * An instruction to argue a position.
 *
 * Every entry here had to survive a pass over the 5,228 past-exam questions in
 * the corpus, because the obvious words do not. `composition` matched
 * "Décomposition de l'eau oxygénée" on 36 chemistry papers — `\b` sits happily
 * between "é" and "c" — and `write a` matched "Write an equation of the plane"
 * on 89 maths ones. Both are gone; what is left is phrasing that a science
 * paper has no reason to use.
 */
const ESSAY_INSTRUCTION = new RegExp(
  [
    '\\bpartagez-vous\\b',
    '\\bdiscutez\\b',
    '\\bdissertez\\b',
    '\\bce jugement\\b',
    '\\bcette citation\\b',
    '\\bcette affirmation\\b',
    '\\bce point de vue\\b',
    '\\bprobl[ée]matiques?\\b',
    '\\bque pensez-vous\\b',
    '\\b[àa] votre avis\\b',
    '\\br[ée]digez\\b',
    '\\bessai argumentatif\\b',
    '\\bexpliquez ce (?:jugement|texte|propos|point)\\b',
    '\\bexpliquez cette (?:id[ée]e|citation|affirmation|pens[ée]e)\\b',
    '\\bdiscuss\\b',
    '\\bto what extent\\b',
    '\\bdo you agree\\b',
    '\\bin your opinion\\b',
    '\\bthe problematic\\b',
    '\\bexplain this (?:judg\\w+|statement|idea|saying|quotation|text)\\b',
    '\\bwrite an? (?:essay|composition|paragraph|argumentative\\s+\\w+)\\b',
  ].join('|'),
  'iu',
);

/**
 * Pointing at something the text does not contain.
 *
 * Not enough to call a question comprehension — "ci-dessus" turns up in a
 * chemistry exercise about a diagram the chapter reproduces — but enough that
 * answering it out of the nearest chapter is a guess wearing a citation. These
 * come back as concept with the confidence turned down, and the gate is raised
 * to match.
 */
const DEICTIC = new RegExp(
  [
    '\\bci-dessus\\b',
    '\\bci-dessous\\b',
    '\\bci-contre\\b',
    '\\bcelui-ci\\b',
    '\\bcelle-ci\\b',
    '\\bcette question\\b',
    '\\bcet exercice\\b',
    '\\bthe above\\b',
    '\\bthe following\\b',
    '\\bthis question\\b',
    '\\bthis exercise\\b',
  ].join('|'),
  'iu',
);

function hasPhrase(despaced: string, list: string[]): string | null {
  return list.find((p) => despaced.includes(p)) ?? null;
}

/**
 * Which kind of question this is, and how sure the rules are.
 *
 * Ordered by how much each marker asserts. A paper that titles a block "Sujet :"
 * has said what it is; a reference to "le texte" is the paper pointing off its
 * own page; an instruction to discuss is an essay prompt only because nothing
 * was pointed at. Concept comes last because it is the default, and the default
 * is the dangerous one to arrive at by accident.
 */
export function classifyQuestionKind(text: string): QuestionClassification {
  const folded = fold(text);
  const despaced = despace(folded);

  const header = ESSAY_HEADER.exec(folded);
  if (header) return { kind: 'essay', confidence: 'high', signal: header[0].trim() };

  const essayPhrase = hasPhrase(despaced, AR_ESSAY);
  if (essayPhrase) return { kind: 'essay', confidence: 'high', signal: essayPhrase };

  /*
   * A document named AND an instruction to argue is the commentaire de texte,
   * and it is an essay. The passage is quoted inside the prompt rather than
   * printed elsewhere on the paper — "Texte : L'homme est un être doué de
   * conscience… Expliquez ce texte en en dégageant la problématique" — so
   * there is nothing to go and fetch, and what is being asked for is an
   * argued piece marked against the philosophy barème. 229 philosophy
   * questions read that way, which is most of the ones the document rule
   * would otherwise have claimed.
   */
  const instruction = ESSAY_INSTRUCTION.exec(folded);
  const reference = DOCUMENT_REFERENCE.exec(folded) ?? AR_SHORT_DOCUMENT.exec(folded);
  const documentPhrase = hasPhrase(despaced, AR_DOCUMENT);

  if (instruction) return { kind: 'essay', confidence: 'high', signal: instruction[0].trim() };
  if (reference) return { kind: 'comprehension', confidence: 'high', signal: reference[0].trim() };
  if (documentPhrase) return { kind: 'comprehension', confidence: 'high', signal: documentPhrase };

  const deictic = DEICTIC.exec(folded);
  const arabicDeictic = hasPhrase(despaced, AR_DEICTIC);
  if (deictic || arabicDeictic) {
    return { kind: 'concept', confidence: 'low', signal: deictic?.[0].trim() ?? arabicDeictic! };
  }

  return { kind: 'concept', confidence: 'high', signal: 'no marker' };
}

/**
 * Does this question send the student to look at something we do not have?
 *
 * `content_images` is empty for all 4,150 questions — the ingestion pipeline
 * has never extracted a figure — while 1,190 of them (29%) name one. A Life
 * Sciences question reads "the results are shown in document 1. Document 2
 * reveals the connection between the small intestine and the liver", and there
 * is no document 1 and no document 2.
 *
 * Left undetected, that question is answered anyway. It matches ITSELF in the
 * corpus at similarity 1.000, `exact_match` is the first tier and short-circuits
 * the comprehension routing that would otherwise have asked for the document, and
 * the student is walked through a graph nobody can see with nothing saying so.
 *
 * Deliberately narrow. It fires on a NUMBERED reference — "document 1",
 * "figure 2", "المستند ٣" — or on an explicit instruction to look at one. A
 * question that merely says "the curve is increasing" is describing its own
 * text and is not asking anyone to look anywhere.
 */
const VISUAL_REFERENCE =
  // Written as a literal, not built from a string: the escaping in a
  // `new RegExp('\b...')` is one backslash away from `\b` meaning a backspace
  // character, which is exactly what it meant here on the first attempt and the
  // pattern silently matched nothing.
  /\b(?:document|doc\.|figure|fig\.|sch[ée]ma|graphe|graphique|diagram)\s*\.?\s*[0-9]|\b(?:shown|represented|given|see|refer to)\s+(?:in\s+)?(?:the\s+)?(?:adjacent\s+)?(?:document|figure|diagram|graph|curve)|\bd['’]apr[eè]s\s+(?:le|la|les)\s+(?:document|figure|sch[ée]ma|graphique)|\b(?:ci-contre|ci-dessous|adjacent)\b|ال?مستند\s*[0-9٠-٩]|ال?شكل\s*[0-9٠-٩]|ال?وثيقة\s*[0-9٠-٩]/i;

/** The reference itself, so the student is told which one is missing. */
export function missingVisual(text: string): string | null {
  const m = VISUAL_REFERENCE.exec(text);
  return m ? m[0].trim() : null;
}
