/**
 * Is this message a curriculum question at all?
 *
 * Retrieval answers "what material is there for this?" and the grounding gate
 * turns "none" into a refusal. That is right for a question and wrong for
 * everything else a person types into a chat box. A student who says "hello"
 * was told *"This isn't covered by the material available for your track"* —
 * which is not an answer to a greeting, reads as a rebuff, and is the first
 * thing anybody does on opening the page.
 *
 * The refusal is a strong claim: it tells a student that something is off their
 * programme. It should only ever be made about a question that was actually
 * asked about the programme. So intent is decided BEFORE retrieval, and the
 * three outcomes go to three different places:
 *
 *   SMALLTALK    "hello", "merci", "شكرا", "how are you"
 *                Answered like a person. No claim about the syllabus either
 *                way, because none was invited.
 *
 *   CAPABILITY   "what can you do", "tu peux m'aider en maths ?", "who are you"
 *                A question about the tutor rather than about the course. The
 *                honest answer names the subjects this student actually has,
 *                which is knowable without retrieving anything.
 *
 *   CURRICULUM   everything else, unchanged: retrieve, ground, or refuse.
 *
 * Rules rather than a model, for the reasons `classifyQuestionKind` gives: this
 * runs before every retrieval, so a model call here is a model call on the
 * critical path of every question asked. The bar for the two non-curriculum
 * lanes is deliberately HIGH — a real question misread as smalltalk would be
 * answered without any material behind it, which is the failure the whole tier
 * system exists to prevent. When in doubt this returns 'curriculum'.
 */

export type ChatIntent = 'smalltalk' | 'capability' | 'curriculum';

export type IntentClassification = {
  intent: ChatIntent;
  /** Which rule decided it. Carried for logging and for the bench. */
  signal: string;
};

/** Same folding the question classifier uses, so both agree on "the same". */
const ARABIC_DIACRITICS = /[ً-ْٰـ]/g;

function fold(text: string): string {
  return text
    .normalize('NFKC')
    // Decompose and drop combining marks, which folds French accents onto their
    // base letters — "comment ça marche" has to reach the same string a table
    // written without a cedilla can hold. It also takes Arabic tashkeel off,
    // which the explicit replacements below then finish.
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/[!?.,;:…"'«»()\[\]-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/*
 * Greetings and courtesies in the three languages of instruction.
 *
 * Anchored whole-string against the folded text rather than searched for. "Hi"
 * inside "what is hydrostatic pressure" must not fire, and a greeting that
 * carries a real question after it — "hello, what is the photoelectric
 * effect?" — is a question, not a greeting, so only a message that is a
 * courtesy AND NOTHING ELSE takes this lane.
 */
const SMALLTALK = [
  // English
  'hi', 'hii', 'hey', 'hello', 'helo', 'yo', 'good morning', 'good afternoon',
  'good evening', 'good night', 'how are you', 'how r u', 'how are u',
  'whats up', 'what s up', 'sup', 'thanks', 'thank you', 'thx', 'ty',
  'thank u', 'ok', 'okay', 'k', 'cool', 'nice', 'great', 'bye', 'goodbye',
  'see you', 'good bye', 'sorry', 'no', 'yes', 'yep', 'nope',
  // French
  'salut', 'bonjour', 'bonsoir', 'coucou', 'allo', 'ca va', 'comment ca va',
  'comment vas tu', 'merci', 'merci beaucoup', 'de rien', 'd accord',
  'daccord', 'ok merci', 'au revoir', 'bonne nuit', 'a bientot', 'pardon',
  'oui', 'non',
  // Arabic
  'مرحبا', 'اهلا', 'اهلا وسهلا', 'السلام عليكم', 'سلام', 'صباح الخير',
  'مساء الخير', 'كيف حالك', 'كيفك', 'شكرا', 'شكرا جزيلا', 'تمام', 'حسنا',
  'مع السلامة', 'وداعا', 'نعم', 'لا', 'عفوا',
];

const SMALLTALK_SET = new Set(SMALLTALK.map(fold));

/*
 * Questions about the tutor rather than about the course.
 *
 * Searched for as phrases, not anchored, because these arrive inside a real
 * sentence: "hi, what can you help me with?". They are checked AFTER smalltalk
 * and BEFORE the curriculum default.
 *
 * "can you help me with maths" is deliberately here and not in curriculum: it
 * names a subject but asks nothing about it, so retrieval has nothing to find
 * and would refuse. The useful answer is what this tutor covers for this
 * student.
 */
const CAPABILITY = [
  'what can you do', 'what do you do', 'what can you help', 'can you help me with',
  'who are you', 'what are you', 'how do you work', 'how does this work',
  'what is this', 'what are you for', 'how can you help', 'can you help',
  'what subjects', 'which subjects', 'what topics',
  'que peux tu faire', 'que sais tu faire', 'qui es tu', 'c est quoi',
  'comment ca marche', 'tu peux m aider', 'peux tu m aider', 'tu sers a quoi',
  'quelles matieres', 'quelle matiere',
  'ماذا تفعل', 'من انت', 'ما هذا', 'كيف تعمل', 'هل يمكنك مساعدتي',
  'بماذا تساعدني', 'ما هي المواد',
].map(fold);

/**
 * A message that asks nothing has no question in it to be off-syllabus.
 *
 * Length is the guard that keeps the smalltalk table from swallowing a real
 * question. Every entry is a short courtesy, and a folded message longer than
 * this is doing something else even if it opens with one.
 */
const SMALLTALK_MAX_WORDS = 4;

export function classifyChatIntent(text: string): IntentClassification {
  const folded = fold(text);

  if (!folded) return { intent: 'smalltalk', signal: 'empty' };

  if (folded.split(' ').length <= SMALLTALK_MAX_WORDS && SMALLTALK_SET.has(folded)) {
    return { intent: 'smalltalk', signal: `courtesy:${folded}` };
  }

  for (const phrase of CAPABILITY) {
    if (folded.includes(phrase)) return { intent: 'capability', signal: `capability:${phrase}` };
  }

  return { intent: 'curriculum', signal: 'default' };
}
