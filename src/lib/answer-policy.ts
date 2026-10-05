/**
 * Whether a subject's questions show students an answer at all.
 *
 * Philosophy shows none (the user, 2026-10-02 and 2026-10-05): its answers are
 * dissertations, and the ministry's key is a marking grid — "المقدمة: (علامتان)",
 * a table header, a list of points — that reads as the answer when it is not
 * one. Nothing is written on request either. The key stays stored: marking a
 * sitting still reads it, it is only never put on a student's screen.
 */
export function showsAnswers(subjectName: string): boolean {
  return !/philo|فلسف/i.test(subjectName);
}
