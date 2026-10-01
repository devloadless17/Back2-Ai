/**
 * A full French language paper accidentally stored as one `Question` row.
 *
 * These rows contain the reading glossary, every comprehension part, the
 * seven-mark writing task and its instructions. They belong on the full-paper
 * screen, never as one practice question, quiz item, mock-paper exercise or AI
 * style reference.
 */
const FRENCH_QUESTIONS = /(?:^|\n)\s*I\s*[-–—.]\s*Questions\b/iu;
const FRENCH_WRITING = /(?:^|\n)\s*II\s*[-–—.]\s*Production\s+[ée]crite\b/iu;

export function isWholeFrenchPaper(text: string): boolean {
  if (FRENCH_QUESTIONS.test(text) && FRENCH_WRITING.test(text)) return true;

  // Older scans often lose the two section headings. Four numbered prompts in
  // one long row are still a comprehension section, not one practice item.
  const numberedPrompts = text.match(/(?:^|\n)\s*\d{1,2}\s*[-.)]/gu)?.length ?? 0;
  return text.length > 800 && numberedPrompts >= 4;
}

/**
 * Material imported into a Francais paper from a neighbouring PDF.
 *
 * The 2021--2024 folders contain philosophy subjects under Francais cycle
 * names, while three SE rows are economics questions or corrections. Their
 * database relations therefore look valid; the content is the only reliable
 * boundary available at runtime.
 */
export function isForeignToFrenchCourse(text: string): boolean {
  const philosophyPaper =
    /expliquez\s+ce\s+jugement/iu.test(text) &&
    /probl[ée]matique\s+qu[’']?il\s+soul[èe]ve/iu.test(text) &&
    /discutez\s+ce\s+jugement/iu.test(text);

  const economicsSignals = [
    /balance\s+commerciale/iu,
    /\bPIB\b/u,
    /unit[ée]s?\s+mon[ée]taires?/iu,
    /flux\s+financiers?/iu,
    /pouvoir\s+d[’']achat/iu,
    /co[uû]t\s+de\s+production/iu,
    /libert[ée]\s+[ée]conomique/iu,
  ].filter((pattern) => pattern.test(text)).length;

  return philosophyPaper || economicsSignals >= 2;
}

/** A correction table accidentally saved in the question field. */
export function isFrenchAnswerKeyFragment(text: string): boolean {
  return /(?:questions?\s+)?r[ée]ponses?\s+crit[èe]res?\s+d[’']?[ée]valuation/iu.test(text) ||
    /[ée]l[ée]ments?\s+de\s+r[ée]ponse\s+crit[èe]res?\s+d[’']?[ée]valuation/iu.test(text);
}

export function isUnusableFrenchExercise(text: string): boolean {
  return isWholeFrenchPaper(text) || isForeignToFrenchCourse(text) || isFrenchAnswerKeyFragment(text);
}
