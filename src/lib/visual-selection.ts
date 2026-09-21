/**
 * Which visuals accompany an exercise — the one rule the student's screen and
 * Nour both follow.
 *
 * Pure: no database, no storage. `visual-evidence.ts` loads the rows and calls
 * `selectVisualEvidence`; the student pages and retrieval both go through that
 * loader, so the two can only ever receive the same ordered keys.
 *
 * Design record: scripts/corpus/VISUAL-EVIDENCE-MODEL.md.
 */

export type VisualRoleName =
  | 'question_evidence'
  | 'exercise_shared'
  | 'exercise_context'
  | 'paper_shared'
  | 'solution_material';

export type VisualAccessName = 'question' | 'solution';
export type VisualStatusName = 'active' | 'pending' | 'rejected';

export type LegacyVerdictName =
  | 'correct'
  | 'wrong_exercise'
  | 'wrong_page'
  | 'header_only'
  | 'unresolved'
  | 'no_crop_on_page'
  | 'no_position_source'
  | 'untraceable';

/** An advisory part locator. Parts are not durable, so this is a hint, not a key. */
export type ConsumerLocator = {
  label: string;
  labelOccurrence: number;
  fingerprint: string;
};

export type VisualRelationRow = {
  occurrenceId: string;
  role: VisualRoleName;
  status: VisualStatusName;
  access: VisualAccessName;
  storageKey: string;
  readingOrder: number;
  groupKey: string | null;
  groupPart: number | null;
  identityText: string | null;
  consumers: ConsumerLocator[] | null;
};

export type SelectionInput = {
  /** The exercise's current text — consumer locators are checked against it. */
  contentText: string;
  relations: VisualRelationRow[];
  legacyImages: string[];
  legacyVerdict: LegacyVerdictName | null;
  /** A part label ("2.1") when the conversation is about one part; else the whole exercise. */
  part?: string | null;
  phase: 'question' | 'solution';
  /**
   * Proof, from the database, that this student has submitted or revealed the
   * exercise. The solution phase returns nothing without it.
   */
  revealed?: boolean;
};

export type SelectedVisual = {
  key: string;
  occurrenceId: string | null;
  groupKey: string | null;
  groupPart: number | null;
  /** Total panels in the group, so a partial load can be recognised as incomplete. */
  groupSize: number | null;
  label: string | null;
};

export type VisualSelection = {
  source: 'canonical' | 'legacy' | 'none';
  visuals: SelectedVisual[];
  /** Keys in order — what the renderer and the model receive. */
  keys: string[];
  /**
   * Question-evidence visuals left out because their only known consumer
   * locator no longer matches the text. Specificity is unavailable, and it is
   * NOT turned into shared evidence.
   */
  unresolvedConsumers: string[];
  /** Groups dropped because a panel was not eligible: never half a document. */
  incompleteGroups: string[];
  /** A legacy page that the audit proved wrong, withheld. */
  legacySuppressed: boolean;
};

/** Verdicts under which the legacy page must never be shown again. */
export const SUPPRESSED_LEGACY: ReadonlySet<LegacyVerdictName> = new Set([
  'wrong_exercise',
  'wrong_page',
  'header_only',
]);

/**
 * Text normalised for locator matching. Letters and digits only, lower case,
 * single spaces: the backfill builds fingerprints with this same function from
 * the canonical extraction, and the runtime checks them against the stored
 * exercise text, which went through different cleaning.
 */
export function normaliseForLocator(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The fingerprint of a part: its first 40 normalised characters, label removed. */
export function partFingerprint(partText: string): string {
  const withoutLabel = partText.replace(/^\s*(?:[A-Za-z]{1,4}\s*[-.)]\s*)?(?:\d+\s*[-.)]\s*)*(?:[a-z]\s*[-.)]\s*)?/, '');
  return normaliseForLocator(withoutLabel).slice(0, 40);
}

/** A locator resolves when its fingerprint is still present in the exercise's text. */
export function locatorResolves(locator: ConsumerLocator, normalisedText: string): boolean {
  return locator.fingerprint.length >= 12 && normalisedText.includes(locator.fingerprint);
}

function eligible(row: VisualRelationRow, input: SelectionInput, normalised: string, unresolved: Set<string>): boolean {
  if (row.status !== 'active') return false;

  if (input.phase === 'solution') {
    return row.role === 'solution_material' && row.access === 'solution';
  }

  // Question phase: two independent guards. A solution-role row never
  // qualifies, and neither does a solution-access occurrence under any role.
  if (row.role === 'solution_material' || row.access !== 'question') return false;

  const part = input.part?.trim();
  if (!part) return true; // the whole exercise: every question-phase visual it owns

  if (row.role === 'exercise_context' || row.role === 'exercise_shared' || row.role === 'paper_shared') {
    return true;
  }

  // question_evidence: only when a live locator says this part consumes it.
  const locators = row.consumers ?? [];
  const live = locators.filter((l) => locatorResolves(l, normalised));
  if (live.length === 0) {
    unresolved.add(row.occurrenceId);
    return false;
  }
  return live.some((l) => l.label === part || l.label.startsWith(`${part}.`) || part.startsWith(`${l.label}.`));
}

export function selectVisualEvidence(input: SelectionInput): VisualSelection {
  const empty: VisualSelection = {
    source: 'none',
    visuals: [],
    keys: [],
    unresolvedConsumers: [],
    incompleteGroups: [],
    legacySuppressed: false,
  };

  if (input.phase === 'solution' && input.revealed !== true) return empty;

  const normalised = normaliseForLocator(input.contentText);
  const unresolved = new Set<string>();
  const active = input.relations.filter((r) => r.status === 'active');
  const chosen = active.filter((r) => eligible(r, input, normalised, unresolved));

  // Panels: a group goes whole or not at all. Every active panel of a group
  // must be eligible; otherwise the group is dropped and named.
  const groupMembers = new Map<string, VisualRelationRow[]>();
  for (const r of active) {
    if (r.groupKey) groupMembers.set(r.groupKey, [...(groupMembers.get(r.groupKey) ?? []), r]);
  }
  const chosenIds = new Set(chosen.map((r) => r.occurrenceId));
  const incomplete = new Set<string>();
  for (const [key, members] of groupMembers) {
    const inGroup = members.filter((m) => chosenIds.has(m.occurrenceId));
    if (inGroup.length > 0 && inGroup.length < members.length) incomplete.add(key);
  }
  const final = chosen
    .filter((r) => !(r.groupKey && incomplete.has(r.groupKey)))
    .sort((a, b) => {
      // A group sits where its first panel sits, panels in groupPart order.
      const ga = a.groupKey ? Math.min(...groupMembers.get(a.groupKey)!.map((m) => m.readingOrder)) : a.readingOrder;
      const gb = b.groupKey ? Math.min(...groupMembers.get(b.groupKey)!.map((m) => m.readingOrder)) : b.readingOrder;
      if (ga !== gb) return ga - gb;
      if ((a.groupPart ?? 0) !== (b.groupPart ?? 0)) return (a.groupPart ?? 0) - (b.groupPart ?? 0);
      return a.readingOrder - b.readingOrder;
    });

  const hasCanonical = input.relations.some(
    (r) => r.status === 'active' && (input.phase === 'solution' || r.role !== 'solution_material'),
  );

  if (final.length > 0 || hasCanonical || input.phase === 'solution') {
    const visuals = final.map((r) => ({
      key: r.storageKey,
      occurrenceId: r.occurrenceId,
      groupKey: r.groupKey,
      groupPart: r.groupPart,
      groupSize: r.groupKey ? groupMembers.get(r.groupKey)!.length : null,
      label: r.identityText,
    }));
    return {
      source: visuals.length > 0 ? 'canonical' : 'none',
      visuals,
      keys: visuals.map((v) => v.key),
      unresolvedConsumers: [...unresolved].sort(),
      incompleteGroups: [...incomplete].sort(),
      // A canonical exercise never falls back: a narrower part selection that
      // comes back empty must not be "helped" by a whole legacy page.
      legacySuppressed: input.legacyImages.length > 0,
    };
  }

  // No active canonical relation at all: the legacy page, unless the audit
  // proved it wrong.
  if (input.legacyImages.length > 0) {
    if (input.legacyVerdict && SUPPRESSED_LEGACY.has(input.legacyVerdict)) {
      return { ...empty, legacySuppressed: true };
    }
    const visuals = input.legacyImages.map((key) => ({
      key,
      occurrenceId: null,
      groupKey: null,
      groupPart: null,
      groupSize: null,
      label: null,
    }));
    return { ...empty, source: 'legacy', visuals, keys: [...input.legacyImages] };
  }

  return empty;
}

// ---------------------------------------------------------------------------
// Content-addressed storage keys
// ---------------------------------------------------------------------------

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** The scope a given access policy stores under. */
export function scopeFor(access: VisualAccessName): 'question-images' | 'solution-images' {
  return access === 'solution' ? 'solution-images' : 'question-images';
}

/**
 * `<scope>/<sha256>.<ext>`. Two segments on purpose: `ownerFromKey` reads the
 * second of three segments as an owner, so a two-segment key has no owner and
 * the generic file route serves a `solution-images` key to nobody but admins.
 * Identical bytes under two access policies become two objects in two scopes.
 */
export function visualStorageKey(access: VisualAccessName, contentHash: string, mediaType: string): string {
  if (!/^[0-9a-f]{64}$/.test(contentHash)) throw new Error('Invalid content hash.');
  const ext = EXTENSIONS[mediaType];
  if (!ext) throw new Error(`Unsupported visual media type: ${mediaType}`);
  return `${scopeFor(access)}/${contentHash}.${ext}`;
}
