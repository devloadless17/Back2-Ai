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
  return FRENCH_QUESTIONS.test(text) && FRENCH_WRITING.test(text);
}
