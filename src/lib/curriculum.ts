/**
 * What state a chapter is in, decided once for the whole product.
 *
 * The practice index and the Bac Map both have to answer this, and they must
 * answer it identically: a student who reads "12 questions" on one page and
 * "nothing here" on the other has no reason to believe either. The two
 * surfaces then do different things with the answer — practice offers a way
 * in, the map reports evidence — but the classification is shared.
 *
 * The order matters, and `readingOnly` is the reason this is worth a function.
 * 320 of 1,193 chapters have textbook material and no past-paper questions.
 * Every one of them used to render as a greyed-out "no questions" row, which
 * is true and tells the student the wrong thing: there is a summary page, the
 * tutor grounded on that reading, and a nearest practisable chapter behind it.
 * Only the 22 chapters with genuinely nothing are inert.
 */
export type ChapterState =
  /** The student has marked work here. Mastery is meaningful. */
  | 'practised'
  /** Questions exist and have not been attempted. Mastery is NOT zero — it is absent. */
  | 'practisable'
  /** Textbook material, no indexed past-paper questions. Not a data failure. */
  | 'readingOnly'
  /** Nothing behind it at all. */
  | 'inert';

export function chapterState(chapter: {
  questionCount: number;
  hasReading: boolean;
  attemptsCount: number;
}): ChapterState {
  /*
   * Questions first, deliberately. A chapter the student has attempted whose
   * questions have since been rejected has evidence but nothing left to
   * practise, and calling it practisable would offer a way in that leads to an
   * empty page. Its mastery is still real and the Bac Map still shows it — the
   * state describes what can be DONE with the chapter, not what is known about
   * the student.
   */
  if (chapter.questionCount > 0) {
    return chapter.attemptsCount > 0 ? 'practised' : 'practisable';
  }
  if (chapter.hasReading) return 'readingOnly';
  return 'inert';
}

/** Whether there is anything to practise, in either practised state. */
export function chapterHasQuestions(state: ChapterState): boolean {
  return state === 'practised' || state === 'practisable';
}

/**
 * True when a chapter has somewhere to send a student.
 *
 * A `readingOnly` chapter does: the chapter page offers its reading and the
 * tutor grounded on it. Only `inert` has nothing.
 */
export function chapterIsReachable(state: ChapterState): boolean {
  return state !== 'inert';
}
