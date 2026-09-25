/**
 * What the printed page leaves at the END of an exam statement once its text
 * is pulled out, and is not part of the question.
 *
 *   مشروع / العادية / الثلاثاء 11 تموز 2023      the paper's header and footer
 *   Page 2 of 4 / 2/3                             page numbers
 *   (علامتان ونصف) (ثلاث علامات) (علامتـــان)     the marks column, read after the text
 *
 * The last one is the case a student reported: a paper prints its marks in a
 * column beside the questions, and the reader emits the whole column after
 * the last question, so the statement ends in a list of marks attached to
 * nothing. The 2023 history paper ended in thirteen of them.
 *
 * Only a trailing block is removed, and only lines that are nothing but
 * furniture. A SINGLE mark label at the end is kept: it is the mark of the
 * last sub-question, printed where it belongs. Two or more in a row is the
 * detached column.
 *
 * Shared by load-exams.ts (so a reload writes clean text) and
 * strip-paper-furniture.ts (so the rows already loaded match what a reload
 * would write, and the two never undo each other).
 */

const MARK_LINE = new RegExp(
  '^\\s*\\(?\\s*(?:' +
    // (علامتان ونصف), (ثلاث علامـــات), (أرب ـع علامات), التسع علامات
    '[\\u0621-\\u064A\\u0640\\s]{0,30}علام[\\u0621-\\u064A\\u0640\\s]*' +
    '|نصف علامة' +
    // (2 points), (0.5point), (9 pts), (٩ علامات), 4 points)
    '|[\\d\\u0660-\\u0669\\u06F0-\\u06F9.,½]+\\s*(?:pts?|points?|marks?|علامة|علامات)\\.?' +
    ')\\s*\\)?\\s*$',
  'i',
);

const WEEKDAY = '(?:السبت|الأحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الخميس|الجمعة)';
const DIGIT = '[\\d\\u0660-\\u0669\\u06F0-\\u06F9]';

const FOOTER_LINE = new RegExp(
  '^\\s*(?:' +
    [
      'العادي\\s?ة',
      'الاستثنائي\\s?ة',
      'مشروع',
      `${WEEKDAY}\\s+${DIGIT}{1,2}\\s+\\S+\\s*${DIGIT}{0,4}`,
      `دورة (?:العام|سنة)\\s*${DIGIT}{0,4}.{0,20}`,
      'امتحانات الشهادة الثانوية.{0,40}',
      'وزارة التربية.{0,40}',
      'المديري\\s?ة العامة.{0,30}',
      'دائرة الامتحانات.{0,30}',
      'Session (?:ordinaire|extraordinaire).{0,20}',
      '(?:Ordinary|Extraordinary) session.{0,20}',
      // Page numbers. "2/3" only as a small page count, never a fraction like 7/12.
      '[1-9]\\s*/\\s*[1-9]',
      'Page\\s*\\d+\\s*(?:of|sur|/)\\s*\\d+',
    ].join('|') +
    ')\\s*$',
  'i',
);

/*
 * The same letterhead, matched with every space removed first. The old text
 * layer splits Arabic words ("المديري ة العام ة للت ربية", "الس بت 31 تموز"),
 * and only a line this short is ever compared, so dropping the spaces cannot
 * join two real sentences into a false match.
 */
const LETTERHEAD_COMPACT = new RegExp(
  '^(?:' +
    [
      'مشروع',
      'العادية',
      'الاستثنائية',
      `${WEEKDAY.replace(/\s/g, '')}${DIGIT}{1,2}\\S{2,8}${DIGIT}{0,4}`,
      `دورة(?:العام|سنة)${DIGIT}{0,4}\\S{0,12}`,
      'امتحاناتالشهادةالثانوية\\S{0,20}',
      'وزارةالتربية\\S{0,30}',
      'المديريةالعامة\\S{0,20}',
      'دائرةالامتحانات\\S{0,20}',
      'فرعا?\\S{0,40}',
      'مسابقةفيمادة\\S{0,30}',
      'المدة:?\\S{0,30}',
      'الاسم:?',
      'الرقم:?',
      '(?:Nom|Name|Num[ée]ro|Number):?',
    ].join('|') +
    ')$',
  'i',
);
const MAX_FURNITURE = 60;

function isFooter(line: string): boolean {
  if (line.trim().length > MAX_FURNITURE) return false;
  return FOOTER_LINE.test(line) || LETTERHEAD_COMPACT.test(line.replace(/[\sـ]+/g, ''));
}

export type Stripped = { text: string; removed: string[] };

/** Remove the trailing block of paper furniture from a statement. */
export function stripPaperFurniture(text: string): Stripped {
  const lines = text.split('\n');
  let end = lines.length;
  const marks: number[] = [];
  const footers: number[] = [];

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    if (MARK_LINE.test(line)) marks.push(i);
    else if (isFooter(line)) footers.push(i);
    else break;
  }

  // A lone mark label is the last sub-question's own mark: keep the block
  // from it downward, dropping only the footers below it.
  const cut = new Set(marks.length >= 2 ? [...marks, ...footers] : footers);
  if (cut.size === 0) return { text, removed: [] };

  const removed: string[] = [];
  const kept = lines.filter((line, i) => {
    if (cut.has(i)) {
      removed.push(line.trim());
      return false;
    }
    return true;
  });
  // Blank lines the removal left at the end.
  while (kept.length && !kept[kept.length - 1]!.trim()) kept.pop();
  end = kept.length;
  return { text: kept.slice(0, end).join('\n'), removed };
}
