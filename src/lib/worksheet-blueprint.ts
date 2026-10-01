import { classifyQuestionKind, type QuestionKind } from '@/lib/question-kind';

export type WorksheetBlueprint = {
  count: number;
  acceptedKinds: QuestionKind[] | null;
};

const COMPREHENSION: WorksheetBlueprint = { count: 1, acceptedKinds: ['comprehension'] };

/**
 * One stored language question is one complete exam section: its passage and
 * all the questions attached to it.  Counting the subquestions as separate
 * worksheet items would mix passages from unrelated papers.
 */
export function worksheetBlueprint(subjectName: string): WorksheetBlueprint {
  const name = subjectName.normalize('NFKC').trim().toLocaleLowerCase();

  if (name === 'english' || name === 'francais' || name === 'français' || name === 'أدب عربي') {
    return COMPREHENSION;
  }

  // The official philosophy paper presents three alternative subjects.
  if (name === 'فلسفة عامة' || name === 'philosophy' || name === 'philosophie') {
    return { count: 3, acceptedKinds: ['essay'] };
  }

  return { count: 8, acceptedKinds: null };
}

export function followsWorksheetBlueprint(subjectName: string, contentText: string): boolean {
  const blueprint = worksheetBlueprint(subjectName);
  if (blueprint.acceptedKinds === null) return true;

  const kind = classifyQuestionKind(contentText).kind;
  if (blueprint.acceptedKinds.includes(kind)) return true;

  // English papers usually introduce the complete reading block as "the
  // following selection". That wording points forward inside the same stored
  // record, so the tutor's narrower missing-document classifier deliberately
  // does not call it comprehension. A worksheet does need to recognise it.
  if (blueprint.acceptedKinds.includes('comprehension')) {
    return /\b(?:read|study)\s+(?:it|the|this)|\b(?:following|below)\s+(?:selection|text|passage|article)|\banswer\s+the\s+questions\s+that\s+follow\b/i.test(
      contentText,
    );
  }

  return false;
}
