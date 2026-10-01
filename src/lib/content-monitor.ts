import { isMissingRequiredPassage, isUnusableFrenchExercise } from '@/lib/question-shape';

export type ContentMonitorIssue = {
  severity: 'critical' | 'warning';
  code: string;
  track: string;
  subject: string;
  chapter: string;
  itemId: string;
  subjectId: string;
  chapterId: string;
  detail: string;
};

type MonitorSubject = {
  id: string;
  name: string;
  language: 'ar' | 'en' | 'fr';
  track: { code: string } | null;
  chapters: {
    id: string;
    name: string;
    cancelledAt: Date | null;
    contentChunks: { chunk: { id: string; contentText: string } }[];
    questions: {
      id: string;
      contentText: string;
      contentLatex: string | null;
      sourcePassage: string | null;
      officialSolution: string | null;
      modelSolution: string | null;
      bareme: unknown;
      verifiedStatus: string;
    }[];
  }[];
};

const ARABIC_MINISTRY = /وزارة\s+التربية\s+والتعليم\s+العالي/u;
const ARABIC_RUN = /[\p{Script=Arabic}\p{Mark}]{3,}(?:\s+[\p{Script=Arabic}\p{Mark}]{2,}){2,}/u;
const BROKEN_ENCODING = /�|Ã[\x80-\xBF]|Â[\x80-\xBF]|â(?:€™|€œ|€|€“|€”)/u;
const PLACEHOLDER_ANSWER = /no (?:worked |official )?answer (?:was )?recorded|no solution (?:was )?recorded/i;

export function inspectContent(subjects: MonitorSubject[]): ContentMonitorIssue[] {
  const issues: ContentMonitorIssue[] = [];
  const add = (
    severity: ContentMonitorIssue['severity'],
    code: string,
    subject: MonitorSubject,
    chapter: MonitorSubject['chapters'][number],
    itemId: string,
    detail: string,
  ) => issues.push({
    severity,
    code,
    track: subject.track?.code ?? '—',
    subject: subject.name,
    chapter: chapter.name,
    itemId,
    subjectId: subject.id,
    chapterId: chapter.id,
    detail,
  });

  for (const subject of subjects) {
    for (const chapter of subject.chapters) {
      if (chapter.cancelledAt) continue;
      if (chapter.contentChunks.length === 0) {
        add('warning', 'no_textbook_material', subject, chapter, chapter.id, 'No textbook material reaches this chapter.');
      }
      if (chapter.questions.length === 0) {
        add('warning', 'no_practice', subject, chapter, chapter.id, 'No student-visible practice question reaches this chapter.');
      }

      for (const question of chapter.questions) {
        const questionBodies = [question.contentText, question.contentLatex ?? '', question.sourcePassage ?? ''];
        const answers = [question.officialSolution ?? '', question.modelSolution ?? ''];
        if ([...questionBodies, ...answers].some((text) => BROKEN_ENCODING.test(text))) {
          add('critical', 'broken_encoding', subject, chapter, question.id, 'Unreadable replacement or mojibake characters.');
        }
        if (questionBodies.some((text) => ARABIC_MINISTRY.test(text)) && subject.language !== 'ar') {
          add('critical', 'foreign_cover', subject, chapter, question.id, 'Arabic ministry cover appended to a non-Arabic item.');
        }
        if (
          subject.language !== 'ar' &&
          !questionBodies.some((text) => ARABIC_MINISTRY.test(text)) &&
          [...questionBodies, ...answers].some((text) => ARABIC_RUN.test(text))
        ) {
          add('critical', 'foreign_script', subject, chapter, question.id, 'Arabic text appears inside a non-Arabic question or answer.');
        }
        if (answers.some((text) => PLACEHOLDER_ANSWER.test(text))) {
          add('critical', 'placeholder_answer', subject, chapter, question.id, 'A missing-answer placeholder would be shown as the answer.');
        }
        if (subject.name === 'Francais' && isUnusableFrenchExercise(question.contentText)) {
          add('critical', 'invalid_french_exercise', subject, chapter, question.id, 'Whole paper, answer table, or foreign subject stored as one French exercise.');
        }
        if (
          isMissingRequiredPassage(question.contentText, question.sourcePassage)
        ) {
          add('critical', 'missing_passage', subject, chapter, question.id, 'The question refers to a text that is not available to the student.');
        }
        if (
          question.verifiedStatus !== 'rejected' &&
          !question.officialSolution?.trim() &&
          !question.modelSolution?.trim()
        ) {
          add('warning', 'missing_answer', subject, chapter, question.id, 'No recorded answer is available.');
        }
        if (question.contentText.length > 5000) {
          add('warning', 'oversized_item', subject, chapter, question.id, 'The exercise is over 5,000 characters and may contain merged pages.');
        }
      }

      for (const link of chapter.contentChunks) {
        if (BROKEN_ENCODING.test(link.chunk.contentText)) {
          add('critical', 'broken_textbook_text', subject, chapter, link.chunk.id, 'Unreadable characters in textbook material.');
        }
      }
    }
  }

  return issues.sort((a, b) =>
    a.severity === b.severity
      ? `${a.track}|${a.subject}|${a.chapter}|${a.code}`.localeCompare(`${b.track}|${b.subject}|${b.chapter}|${b.code}`)
      : a.severity === 'critical' ? -1 : 1,
  );
}
