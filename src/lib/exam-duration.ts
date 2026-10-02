/**
 * How long a sitting runs, and whether that is the paper's own answer.
 *
 * `exam_cycles.duration_minutes` defaults to 180 and the bulk corpus loader
 * never sets it, so an ingested official paper was indistinguishable from one
 * whose duration we actually knew. Every real past paper ran a three-hour
 * clock while being described as sat exactly as it was printed — and Lebanese
 * Bac Mathematics SG is four hours.
 *
 * `duration_is_official` now carries the difference, and this is the one place
 * that turns the pair into words, so the setup screen and the sitting cannot
 * describe the same clock differently.
 */
export type DurationLabels = {
  hours: string;
  hoursMinutes: string;
  minutesOnly: string;
};

/** "4h", "3h 30", "45 min" — through the dictionary, never hardcoded. */
export function formatDuration(minutes: number, labels: DurationLabels): string {
  const whole = Math.max(0, Math.floor(minutes));
  const h = Math.floor(whole / 60);
  const m = whole % 60;

  if (h === 0) return labels.minutesOnly.replace('{minutes}', String(m));
  if (m === 0) return labels.hours.replace('{hours}', String(h));
  return labels.hoursMinutes
    .replace('{hours}', String(h))
    .replace('{minutes}', String(m).padStart(2, '0'));
}

/** The standard clock when neither the paper nor its subject has a length. */
export const STANDARD_EXAM_MINUTES = 180;

export type PaperDuration = {
  minutes: number;
  /** True when the length came from the paper or from its subject's setting. */
  official: boolean;
  source: 'paper' | 'subject' | 'standard';
};

/**
 * How long a paper is sat for.
 *
 * The paper's own confirmed length first; then its subject's — set once in
 * Exam timing, because every GS Chemistry paper runs on the same clock; then
 * the standard three hours, which the exam screen labels as ours.
 */
export function paperDuration(
  paper: { durationMinutes: number; durationIsOfficial: boolean } | null,
  subjectMinutes: number | null | undefined,
): PaperDuration {
  if (paper?.durationIsOfficial) {
    return { minutes: paper.durationMinutes, official: true, source: 'paper' };
  }
  if (subjectMinutes) return { minutes: subjectMinutes, official: true, source: 'subject' };
  return { minutes: STANDARD_EXAM_MINUTES, official: false, source: 'standard' };
}
