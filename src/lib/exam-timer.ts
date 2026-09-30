/** Whole seconds left on the server-issued deadline, rounded up for display. */
export function secondsUntil(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}
