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
 *   PLANNING     "when should I revise physics", "am I behind", "what's my
 *                plan for this week", "how many days until the exam"
 *                A question about their own revision rather than about the
 *                course. No passage in any textbook answers it; the answer is
 *                in their schedule, their mastery and their exam date, all of
 *                which the product holds exactly. Sending these to retrieval
 *                produced a refusal about the syllabus for a question that was
 *                never about the syllabus.
 *
 *   CURRICULUM   everything else, unchanged: retrieve, ground, or answer from
 *                general knowledge under a label.
 *
 * Rules rather than a model, for the reasons `classifyQuestionKind` gives: this
 * runs before every retrieval, so a model call here is a model call on the
 * critical path of every question asked. The bar for the two non-curriculum
 * lanes is deliberately HIGH — a real question misread as smalltalk would be
 * answered without any material behind it, which is the failure the whole tier
 * system exists to prevent. When in doubt this returns 'curriculum'.
 */

export type ChatIntent = 'smalltalk' | 'capability' | 'planning' | 'curriculum';

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

/*
 * Questions about their own revision rather than about the course.
 *
 * Every entry is possessive, second-person-imperative, or bounded by a word
 * that pins it to this student — "my schedule", "should i revise", "days until
 * the exam". That is not stylistic. The bare nouns are all collisions:
 *
 *   `plan`      French for the outline of an essay. "Quel est le plan du
 *               texte ?" is a comprehension question about a passage, and
 *               reading it as a scheduling request would answer a literature
 *               question with a revision timetable. Only `mon planning`,
 *               `mon plan de revision` and `emploi du temps` are here.
 *   `revision`  "revision of the constitution" in history.
 *   `how many days` "How many days does Mercury take to orbit the Sun?" is a
 *               physics question. Only the forms that name the exam are here.
 *   `program`   "programme" is the syllabus itself in French, so `mon
 *               programme de revision` is qualified twice over.
 *
 * Searched as substrings, like CAPABILITY, because they arrive inside real
 * sentences: "ok so what should i revise tonight".
 */
const PLANNING = [
  // English
  'my schedule', 'my plan', 'my revision', 'my study plan', 'my timetable',
  'study plan', 'revision plan', 'what should i study', 'what should i revise',
  'should i study', 'should i revise', 'what should i do next',
  'what do i do next', 'where do i start', 'where should i start',
  'what s next', 'whats next', 'am i ready', 'am i behind', 'am i on track',
  'how am i doing', 'days until', 'days till', 'days left', 'days to go',
  'how long until', 'how long do i have', 'what s due', 'whats due',
  'what is due', 'plan my', 'organise my', 'organize my', 'help me plan',
  'time to study', 'how much time should i',
  // French
  'mon planning', 'mon emploi du temps', 'emploi du temps',
  'mon plan de revision', 'mon programme de revision', 'plan de revision',
  'programme de revision', 'que dois je reviser', 'qu est ce que je dois reviser',
  'je dois reviser quoi', 'par quoi commencer', 'par ou commencer',
  'je suis pret', 'suis je pret', 'je suis en retard', 'ou j en suis',
  'combien de jours avant', 'combien de jours il me reste',
  'combien de temps il me reste', 'organise moi', 'aide moi a planifier',
  'quoi reviser',
  // Arabic
  'برنامجي', 'جدولي', 'خطتي', 'جدول الدراسه', 'خطه المراجعه', 'برنامج المراجعه',
  'ماذا ادرس', 'ماذا اراجع', 'من اين ابدا', 'هل انا جاهز', 'هل انا متاخر',
  'كم يوم بقي', 'كم بقي من الوقت', 'كم يوما تبقى', 'نظم لي', 'ساعدني في التخطيط',
  'ما التالي',
].map(fold);

/**
 * A message that asks nothing has no question in it to be off-syllabus.
 *
 * Length is the guard that keeps the smalltalk table from swallowing a real
 * question. Every entry is a short courtesy, and a folded message longer than
 * this is doing something else even if it opens with one.
 */
const SMALLTALK_MAX_WORDS = 4;

/**
 * Above this, a message is a curriculum question whatever phrase it contains.
 *
 * Both non-default tables are matched as substrings, because their entries
 * arrive inside real sentences. That is right for a sentence and wrong for a
 * pasted exam paper, and students paste exam papers constantly — it is the
 * commonest way they ask anything here.
 *
 * Measured over the 5,297 past-exam questions in the corpus, 22 of them matched
 * a non-curriculum phrase buried somewhere in their body: ten English papers
 * contained "what is this", eleven Arabic ones contained "من انت" as a
 * substring inside ordinary words, and one French economics text mentioned an
 * "emploi du temps". Every one of those would have answered a student's pasted
 * question with a description of what the tutor can do.
 *
 * A length ceiling separates the two cleanly, because the collision needs a
 * long body to hide in. Thirty words is far above any real "what can you do"
 * or "what should I revise tonight" and far below a pasted question.
 */
const CONVERSATIONAL_MAX_WORDS = 30;

export function classifyChatIntent(text: string): IntentClassification {
  const folded = fold(text);

  if (!folded) return { intent: 'smalltalk', signal: 'empty' };

  if (folded.split(' ').length <= SMALLTALK_MAX_WORDS && SMALLTALK_SET.has(folded)) {
    return { intent: 'smalltalk', signal: `courtesy:${folded}` };
  }

  /*
   * Long messages skip both tables. See CONVERSATIONAL_MAX_WORDS: a phrase
   * match inside a pasted paper is a coincidence, not an intent.
   */
  if (folded.split(' ').length > CONVERSATIONAL_MAX_WORDS) {
    return { intent: 'curriculum', signal: 'default:too-long' };
  }

  /*
   * Planning before capability, because the capability phrasings are the more
   * general of the two and would otherwise swallow the specific case: "can you
   * help me with my schedule" matches `can you help me with`, and answering it
   * by listing the student's subjects is not an answer to it. Ordering this way
   * costs nothing in the other direction — "can you help me with maths" carries
   * no planning marker and still reaches capability.
   */
  for (const phrase of PLANNING) {
    if (folded.includes(phrase)) return { intent: 'planning', signal: `planning:${phrase}` };
  }

  for (const phrase of CAPABILITY) {
    if (folded.includes(phrase)) return { intent: 'capability', signal: `capability:${phrase}` };
  }

  return { intent: 'curriculum', signal: 'default' };
}
