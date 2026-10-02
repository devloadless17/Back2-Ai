/**
 * Folders named by the year alone, read off the papers' own covers.
 *
 * "gs/2019" and "ls/2019" hold the exceptional session — every cover in them
 * reads الدورة الاستثنائية, dated July–August 2019 — while "gs/2019 1" holds
 * the ordinary one. A bare year used to fall through to session 1, so the two
 * sessions were filed as one paper.
 */
const SESSION_OF_FOLDER: Record<string, 'session1' | 'session2'> = {
  'gs/2019': 'session2',
  'ls/2019': 'session2',
};

export function sessionOf(session: string, track?: string): string {
  const folder = track ? SESSION_OF_FOLDER[`${track.toLowerCase()}/${session.trim()}`] : undefined;
  if (folder) return folder;
  return /\s2$/.test(session) ? 'session2' : 'session1';
}
