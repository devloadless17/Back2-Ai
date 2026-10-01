import { classifyQuestionKind, type QuestionKind } from '@/lib/question-kind';

export type WorksheetBlueprint = {
  count: number | null;
  acceptedKinds: QuestionKind[] | null;
  selection: 'filtered' | 'official_cycle';
};

const COMPREHENSION: WorksheetBlueprint = {
  count: 1,
  acceptedKinds: ['comprehension'],
  selection: 'filtered',
};

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
    return { count: 3, acceptedKinds: ['essay'], selection: 'filtered' };
  }

  // Every other worksheet inherits one complete, representative official
  // paper. This preserves the subject AND track-specific exercise count and
  // order without maintaining a second set of rules beside the exam corpus.
  return { count: null, acceptedKinds: null, selection: 'official_cycle' };
}

export type WorksheetBlueprintRow = {
  sourceExamId: string | null;
  orderIndex: number | null;
  year: number | null;
  usable?: boolean;
};

export const PREFERRED_WORKSHEET_YEAR = 2024;

const TOP_LEVEL_ROMAN_HEADING = /(?:^|\n)\s*(?:I|II|III|IV|V|VI|VII|VIII)\s*[-–—.]\s*/g;

/**
 * OCR sometimes attaches the next official section heading to the end of the
 * previous exercise. Rendering that row produces "... IV ... V" followed by
 * the body of V in another card. A top-level heading belongs at the beginning
 * of an exercise; one appearing deep inside a row proves its boundaries broke.
 */
export function hasBrokenWorksheetBoundaries(text: string): boolean {
  for (const match of text.matchAll(TOP_LEVEL_ROMAN_HEADING)) {
    if ((match.index ?? 0) > 120) return true;
  }
  return false;
}

/** Select one real paper whose size is representative of this subject's corpus. */
export function selectOfficialCycle<T extends WorksheetBlueprintRow>(rows: T[]): T[] {
  const cycles = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.sourceExamId) continue;
    const cycle = cycles.get(row.sourceExamId) ?? [];
    cycle.push(row);
    cycles.set(row.sourceExamId, cycle);
  }
  if (cycles.size === 0) return [];

  // Reject the whole source paper when even one exercise is unusable. Dropping
  // only that row would create a neat-looking worksheet with a structural hole.
  const groups = [...cycles.values()].filter((group) => group.every((row) => row.usable !== false));
  if (groups.length === 0) return [];
  const sizes = groups.map((group) => group.length).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)]!;
  groups.sort((a, b) => {
    const aPreferred = a[0]?.year === PREFERRED_WORKSHEET_YEAR ? 1 : 0;
    const bPreferred = b[0]?.year === PREFERRED_WORKSHEET_YEAR ? 1 : 0;
    if (aPreferred !== bPreferred) return bPreferred - aPreferred;

    const distance = Math.abs(a.length - median) - Math.abs(b.length - median);
    if (distance !== 0) return distance;
    return (b[0]?.year ?? 0) - (a[0]?.year ?? 0);
  });

  return groups[0]!.sort(
    (a, b) => (a.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.orderIndex ?? Number.MAX_SAFE_INTEGER),
  );
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
