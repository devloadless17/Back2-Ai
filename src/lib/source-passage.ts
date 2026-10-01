import { withoutAppendedArabicCover } from '@/lib/question-body';

/**
 * Removes material appended after an Arabic exam's document block.
 *
 * Geography OCR can store the whole paper in `source_passage`: documents,
 * questions, then the correction key. Students and the tutor need the source
 * documents only. Boundaries match only at the start of a line, so ordinary
 * prose containing the word "questions" remains intact.
 */
const AFTER_DOCUMENTS = /^\s*(?:الأسئلة|أسس\s+التصحيح|معايير\s+التصحيح|سلم\s+التصحيح|عناصر\s+الإجابة)(?=\s*:|\s*$)/mu;
const TRAILING_PAGE = /\n\s*صفحة\s+[0-9٠-٩]+\s+من\s+[0-9٠-٩]+\s*$/u;

export function studentPassage(passage: string): string {
  const withoutCover = withoutAppendedArabicCover(passage);
  const boundary = AFTER_DOCUMENTS.exec(withoutCover);
  if (!boundary) return withoutCover.trim();

  return withoutCover
    .slice(0, boundary.index)
    .trimEnd()
    .replace(TRAILING_PAGE, '')
    .trim();
}
