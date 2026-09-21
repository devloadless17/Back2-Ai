import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ConsumerLocator,
  partFingerprint,
  selectVisualEvidence,
  type SelectionInput,
  type VisualRelationRow,
  visualStorageKey,
} from '@/lib/visual-selection';

/**
 * Canonical visual evidence — the acceptance cases of
 * scripts/corpus/VISUAL-EVIDENCE-MODEL.md.
 *
 * The selector is pure, so most cases run on rows. The security cases drive
 * the real route handlers with the database, session and storage mocked: the
 * question is what a request can reach, and that is decided in the handler.
 */

// ---------------------------------------------------------------------------
// Mocks for the route and loader cases
// ---------------------------------------------------------------------------
const store = new Map<string, Buffer>();
const dbState = {
  relations: [] as Array<Record<string, unknown>>,
  audits: [] as Array<{ questionId: string; verdict: string }>,
  attempts: [] as Array<{ userId: string; questionId: string }>,
  submittedSims: [] as Array<{ userId: string; questionId: string }>,
  occurrences: new Map<string, Record<string, unknown>>(),
};
let sessionUser: { id: string; role: 'student' | 'admin' } | null = null;

vi.mock('@/lib/storage', () => ({
  getObject: async (key: string) => {
    const hit = store.get(key);
    if (!hit) throw new Error('not found');
    return hit;
  },
  ownerFromKey: (key: string) => {
    const parts = key.split('/');
    return parts.length >= 3 ? (parts[1] ?? null) : null;
  },
}));

vi.mock('@/lib/auth/guards', () => ({
  apiUser: async () =>
    sessionUser
      ? { ok: true, session: { user: sessionUser }, user: sessionUser }
      : { ok: false, status: 401, error: 'Authentication required.' },
}));

type Where = { questionId?: { in: string[] }; userId?: string; examSimulation?: { userId: string } };

vi.mock('@/lib/db', () => ({
  db: {
    questionVisual: {
      findMany: async ({ where }: { where: { questionId: { in: string[] } } }) =>
        dbState.relations.filter((r) => where.questionId.in.includes(r.questionId as string) && r.status === 'active'),
    },
    legacyImageAudit: {
      findMany: async ({ where }: { where: { questionId: { in: string[] } } }) =>
        dbState.audits.filter((a) => where.questionId.in.includes(a.questionId)),
    },
    attempt: {
      findMany: async ({ where }: { where: Where }) =>
        dbState.attempts.filter((a) => a.userId === where.userId && where.questionId!.in.includes(a.questionId)),
    },
    examSimulationQuestion: {
      findMany: async ({ where }: { where: Where }) =>
        dbState.submittedSims.filter(
          (s) => s.userId === where.examSimulation!.userId && where.questionId!.in.includes(s.questionId),
        ),
    },
    visualOccurrence: {
      findUnique: async ({ where }: { where: { id: string } }) => dbState.occurrences.get(where.id) ?? null,
    },
    userReference: { findFirst: async () => null },
    examAnswer: { findFirst: async () => null },
    chatSession: { findFirst: async () => null },
  },
}));

beforeEach(() => {
  store.clear();
  dbState.relations = [];
  dbState.audits = [];
  dbState.attempts = [];
  dbState.submittedSims = [];
  dbState.occurrences.clear();
  sessionUser = null;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const H = (s: string) => createHash('sha256').update(s).digest('hex');

function row(id: string, over: Partial<VisualRelationRow> = {}): VisualRelationRow {
  return {
    occurrenceId: id,
    role: 'exercise_context',
    status: 'active',
    access: 'question',
    storageKey: visualStorageKey('question', H(id), 'image/jpeg'),
    readingOrder: 0,
    groupKey: null,
    groupPart: null,
    identityText: null,
    consumers: null,
    ...over,
  };
}

const TEXT =
  'Mechanical oscillator. The aim of this exercise is to study free oscillations. ' +
  'B.1 Referring to figure 2, give the value of the pseudo-period T of the motion. ' +
  'B.2 Referring to figures 2 and 3, specify which curve represents the elastic potential energy. ' +
  'B.4 On figure 3 two particular instants t1 and t2 are located.';

function loc(label: string, partText: string): ConsumerLocator {
  return { label, labelOccurrence: 0, fingerprint: partFingerprint(partText) };
}

const B1 = loc('B.1', 'B.1 Referring to figure 2, give the value of the pseudo-period T of the motion.');
const B2 = loc('B.2', 'B.2 Referring to figures 2 and 3, specify which curve represents the elastic potential energy.');
const B4 = loc('B.4', 'B.4 On figure 3 two particular instants t1 and t2 are located.');

function input(over: Partial<SelectionInput>): SelectionInput {
  return { contentText: TEXT, relations: [], legacyImages: [], legacyVerdict: null, phase: 'question', ...over };
}

// ---------------------------------------------------------------------------
// C4 acceptance cases
// ---------------------------------------------------------------------------
describe('C4 acceptance', () => {
  it('1. an exercise-context figure accompanies the whole exercise and every part', () => {
    const rels = [row('ctx')];
    expect(selectVisualEvidence(input({ relations: rels })).keys).toEqual([rels[0]!.storageKey]);
    expect(selectVisualEvidence(input({ relations: rels, part: 'B.4' })).keys).toEqual([rels[0]!.storageKey]);
  });

  it('2. a question-owned figure goes to its part only', () => {
    const fig3 = row('fig3', { role: 'question_evidence', consumers: [loc('II.1', 'II.1 Justify the direction of the current in figure (3).')] });
    const text = 'Flash of a camera. II.1 Justify the direction of the current in figure (3). II.2 Calculate the energy.';
    expect(selectVisualEvidence(input({ contentText: text, relations: [fig3], part: 'II.1' })).keys).toEqual([fig3.storageKey]);
    expect(selectVisualEvidence(input({ contentText: text, relations: [fig3], part: 'II.2' })).keys).toEqual([]);
  });

  it('3. a visual shared by sibling questions reaches each of them', () => {
    const doc1 = row('doc1', { role: 'exercise_shared', consumers: [B1, B2] });
    for (const part of ['B.1', 'B.2', 'B.4']) {
      expect(selectVisualEvidence(input({ relations: [doc1], part })).keys).toEqual([doc1.storageKey]);
    }
  });

  it('4. several figures consumed by one question are all sent, in reading order', () => {
    const fig2 = row('fig2', { role: 'question_evidence', consumers: [B1, B2], readingOrder: 1 });
    const fig3 = row('fig3', { role: 'question_evidence', consumers: [B2, B4], readingOrder: 2 });
    expect(selectVisualEvidence(input({ relations: [fig3, fig2], part: 'B.2' })).keys).toEqual([fig2.storageKey, fig3.storageKey]);
  });

  /*
   * THE KNOWN EXPECTED FAILURE. gs/2015 1/phy_en.pdf prints "Fig.3" inside the
   * crop, but Mathpix wrote `\caption{Fig. 1}` for it, so C3 records its
   * identity as figure 1 and part B.2 ("figures 2 and 3") never consumes it.
   * Identity matching is not weakened to make this pass; the case stays red,
   * recorded with `it.fails`, until a caption source better than Mathpix exists.
   */
  const ARTIFACT = 'corpus/.mapping/figure-ownership.json';
  const realCase = existsSync(ARTIFACT) ? it.fails : it.skip;
  realCase('4b. [expected failure] the real Fig.3 crop is identified as figure 3', () => {
    const occ = (JSON.parse(readFileSync(ARTIFACT, 'utf-8')) as { occurrences: Array<{ occurrenceId: string; visualIdentity: { number: number } | null }> })
      .occurrences.find((o) => o.occurrenceId === 'c14180966210/d4b49e5cf3914322');
    expect(occ?.visualIdentity?.number).toBe(3);
  });

  it('5. a multi-panel document goes whole or not at all', () => {
    const panels = [1, 2, 3].map((p) => row(`p${p}`, { groupKey: 'doc2', groupPart: p, readingOrder: 10 + p }));
    const whole = selectVisualEvidence(input({ relations: panels }));
    expect(whole.keys).toEqual(panels.map((p) => p.storageKey));
    expect(whole.visuals.every((v) => v.groupSize === 3)).toBe(true);

    // One panel not eligible (solution access) → the group is withheld, and named.
    const broken = [...panels.slice(0, 2), { ...panels[2]!, access: 'solution' as const }];
    const partial = selectVisualEvidence(input({ relations: broken }));
    expect(partial.keys).toEqual([]);
    expect(partial.incompleteGroups).toEqual(['doc2']);
  });

  it('6. a solution visual is never selected before reveal', () => {
    const sol = row('sol', { role: 'solution_material', access: 'solution', storageKey: visualStorageKey('solution', H('sol'), 'image/png') });
    expect(selectVisualEvidence(input({ relations: [sol] })).keys).toEqual([]);
    expect(selectVisualEvidence(input({ relations: [sol], phase: 'solution' })).keys).toEqual([]);
    expect(selectVisualEvidence(input({ relations: [sol], phase: 'solution', revealed: false })).keys).toEqual([]);
    // A question-role row on a solution-access occurrence is refused too.
    const leaked = { ...sol, role: 'exercise_context' as const };
    expect(selectVisualEvidence(input({ relations: [leaked] })).keys).toEqual([]);
  });

  it('7. the same solution visual is available after reveal', () => {
    const sol = row('sol', { role: 'solution_material', access: 'solution', storageKey: visualStorageKey('solution', H('sol'), 'image/png') });
    expect(selectVisualEvidence(input({ relations: [sol], phase: 'solution', revealed: true })).keys).toEqual([sol.storageKey]);
  });

  it('8. duplicate content: two occurrences, one stored object', () => {
    const hash = H('same-bytes');
    const a = row('a', { storageKey: visualStorageKey('question', hash, 'image/jpeg'), readingOrder: 1 });
    const b = row('b', { storageKey: visualStorageKey('question', hash, 'image/jpeg'), readingOrder: 2 });
    const s = selectVisualEvidence(input({ relations: [a, b] }));
    expect(s.visuals.map((v) => v.occurrenceId)).toEqual(['a', 'b']);
    expect(new Set(s.keys).size).toBe(1);
  });

  it('9. a correct legacy page is replaced by the precise crop', () => {
    const crop = row('crop');
    const s = selectVisualEvidence(input({ relations: [crop], legacyImages: ['/figures/abc-p2.png'], legacyVerdict: 'correct' }));
    expect(s.source).toBe('canonical');
    expect(s.keys).toEqual([crop.storageKey]);
  });

  it('10. a wrong previous-exercise page is repaired: withheld here, the crop shown on its owner', () => {
    // lh/2015 2/bio_fr.pdf: exercise 3 held page 2, which carries exercise 2's Document 2.
    const ex3 = selectVisualEvidence(input({ legacyImages: ['/figures/abc-p2.png'], legacyVerdict: 'wrong_exercise' }));
    expect(ex3.keys).toEqual([]);
    expect(ex3.legacySuppressed).toBe(true);
    const doc2 = row('doc2');
    expect(selectVisualEvidence(input({ relations: [doc2] })).keys).toEqual([doc2.storageKey]);
  });

  it('11. an unresolved legacy association is preserved, not guessed', () => {
    const s = selectVisualEvidence(input({ legacyImages: ['/figures/abc-p1.png'], legacyVerdict: 'unresolved' }));
    expect(s.source).toBe('legacy');
    expect(s.keys).toEqual(['/figures/abc-p1.png']);
    // And with no verdict at all (untraced), the same.
    expect(selectVisualEvidence(input({ legacyImages: ['/figures/x-p1.png'] })).keys).toEqual(['/figures/x-p1.png']);
  });
});

// ---------------------------------------------------------------------------
// Precheck corrections and additions
// ---------------------------------------------------------------------------
describe('stale part locators', () => {
  it('a stale fingerprint does not broaden question evidence to exercise context', () => {
    const stale = row('q', { role: 'question_evidence', consumers: [{ label: 'B.2', labelOccurrence: 0, fingerprint: 'text that the parser no longer produces at all' }] });
    const part = selectVisualEvidence(input({ relations: [stale], part: 'B.2' }));
    expect(part.keys).toEqual([]);
    expect(part.unresolvedConsumers).toEqual(['q']);
    // Its exercise-level ownership stands: the whole exercise still shows it.
    expect(selectVisualEvidence(input({ relations: [stale] })).keys).toEqual([stale.storageKey]);
  });

  it('independently shared or context visuals still accompany a part whose locators went stale', () => {
    const shared = row('s', { role: 'exercise_shared', consumers: [{ label: 'B.1', labelOccurrence: 0, fingerprint: 'gone gone gone gone' }] });
    expect(selectVisualEvidence(input({ relations: [shared], part: 'B.2' })).keys).toEqual([shared.storageKey]);
  });
});

describe('access policy', () => {
  it('identical bytes under question and solution access become two objects in two scopes', () => {
    const hash = H('89a1da6ee0c1');
    const q = visualStorageKey('question', hash, 'image/jpeg');
    const s = visualStorageKey('solution', hash, 'image/jpeg');
    expect(q).toBe(`question-images/${hash}.jpg`);
    expect(s).toBe(`solution-images/${hash}.jpg`);
    expect(q).not.toBe(s);
  });

  it('keys are content-addressed and refuse bad input', () => {
    expect(() => visualStorageKey('question', 'not-a-hash', 'image/jpeg')).toThrow();
    expect(() => visualStorageKey('question', H('x'), 'application/pdf')).toThrow();
  });
});

describe('legacy fallback', () => {
  for (const verdict of ['wrong_exercise', 'wrong_page', 'header_only'] as const) {
    it(`${verdict}: never reappears when no canonical relation exists`, () => {
      const s = selectVisualEvidence(input({ legacyImages: ['/figures/p.png'], legacyVerdict: verdict }));
      expect(s.keys).toEqual([]);
      expect(s.source).toBe('none');
      expect(s.legacySuppressed).toBe(true);
    });
  }

  it('pending canonical rows do not displace a permitted legacy page', () => {
    const pending = row('p', { status: 'pending' });
    expect(selectVisualEvidence(input({ relations: [pending], legacyImages: ['/figures/p.png'] })).source).toBe('legacy');
  });

  it('a canonical exercise never falls back to the whole legacy page for a narrow part', () => {
    const ctxOnlyForOthers = row('q', { role: 'question_evidence', consumers: [B4] });
    const s = selectVisualEvidence(input({ relations: [ctxOnlyForOthers], legacyImages: ['/figures/p.png'], part: 'B.1' }));
    expect(s.keys).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Security: the routes a request can actually reach
// ---------------------------------------------------------------------------
describe('solution security (P0)', () => {
  const SOL_ID = '11111111-1111-4111-8111-111111111111';
  const QID = '22222222-2222-4222-8222-222222222222';
  const hash = H('solution-bytes');
  const solKey = visualStorageKey('solution', hash, 'image/png');

  function seedSolution() {
    store.set(solKey, Buffer.from('solution-bytes'));
    dbState.occurrences.set(SOL_ID, {
      access: 'solution',
      storageKey: solKey,
      asset: { mediaType: 'image/png' },
      relations: [{ questionId: QID }],
    });
  }

  async function solutionRoute() {
    const { GET } = await import('@/app/api/visuals/solution/[occurrenceId]/route');
    return GET(new Request('http://x/api/visuals/solution/' + SOL_ID), { params: Promise.resolve({ occurrenceId: SOL_ID }) });
  }

  async function filesRoute(key: string) {
    const { GET } = await import('@/app/api/files/[...key]/route');
    return GET(new Request('http://x/api/files/' + key), { params: Promise.resolve({ key: key.split('/') }) });
  }

  it('unauthenticated: no solution through either route', async () => {
    seedSolution();
    expect((await solutionRoute()).status).toBe(401);
    expect((await filesRoute(solKey)).status).toBe(401);
  });

  it('signed in, still solving: 404 through the solution route', async () => {
    seedSolution();
    sessionUser = { id: 'u1', role: 'student' };
    expect((await solutionRoute()).status).toBe(404);
  });

  it('knowing or guessing the storage key opens nothing through the file route', async () => {
    seedSolution();
    sessionUser = { id: 'u1', role: 'student' };
    expect((await filesRoute(solKey)).status).toBe(404);
    // Even after submitting: the file route never serves solution-images.
    dbState.attempts.push({ userId: 'u1', questionId: QID });
    expect((await filesRoute(solKey)).status).toBe(404);
  });

  it('submitted: the solution route serves exactly those bytes', async () => {
    seedSolution();
    sessionUser = { id: 'u1', role: 'student' };
    dbState.attempts.push({ userId: 'u1', questionId: QID });
    const res = await solutionRoute();
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('solution-bytes');
  });

  it('a submitted exam simulation also counts as revealed; another student\'s does not', async () => {
    seedSolution();
    sessionUser = { id: 'u2', role: 'student' };
    dbState.submittedSims.push({ userId: 'u1', questionId: QID });
    expect((await solutionRoute()).status).toBe(404);
    dbState.submittedSims.push({ userId: 'u2', questionId: QID });
    expect((await solutionRoute()).status).toBe(200);
  });

  it('Nour retrieval never receives a solution visual before reveal', async () => {
    const { selectVisualsFor } = await import('@/lib/visual-evidence');
    dbState.relations.push({
      questionId: QID, role: 'solution_material', status: 'active', consumers: null,
      occurrence: { id: SOL_ID, access: 'solution', storageKey: solKey, readingOrder: 0, groupKey: null, groupPart: null, identityText: null },
    });
    const q = { id: QID, contentText: TEXT, contentImages: [] };
    expect((await selectVisualsFor([q])).get(QID)!.keys).toEqual([]);
    expect((await selectVisualsFor([q], { phase: 'solution', userId: 'u1' })).get(QID)!.keys).toEqual([]);
    dbState.attempts.push({ userId: 'u1', questionId: QID });
    expect((await selectVisualsFor([q], { phase: 'solution', userId: 'u1' })).get(QID)!.keys).toEqual([solKey]);
  });
});

// ---------------------------------------------------------------------------
// Panels through the model's loader, and student/model parity
// ---------------------------------------------------------------------------
describe('panels and parity', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  it('a panel that fails to load withdraws its whole group and marks the evidence incomplete', async () => {
    const { loadSourceFigures } = await import('@/lib/figures');
    const { visualEvidenceState } = await import('@/lib/chat');
    const k1 = visualStorageKey('question', H('p1'), 'image/png');
    const k2 = visualStorageKey('question', H('p2'), 'image/png');
    store.set(k1, PNG); // k2 is missing
    const group = { groupKey: 'doc2', size: 2 };
    const loaded = await loadSourceFigures([
      { id: 'q', kind: 'question', label: 'Q', similarity: 1, text: 'Document 2', images: [k1, k2], imageGroups: [group, group] },
    ]);
    expect(loaded.images).toEqual([]);
    expect(loaded.sourcesIncompleteEvidence).toEqual([1]);
    expect(visualEvidenceState(loaded.images.length > 0, 'Using document 2, explain.')).not.toBe('attached');
  });

  it('student and model resolve the same ordered keys and the same bytes', async () => {
    const { selectVisualsFor, visualKeysFor } = await import('@/lib/visual-evidence');
    const { loadSourceFigures } = await import('@/lib/figures');
    const QID = '33333333-3333-4333-8333-333333333333';
    const keys = ['a', 'b'].map((n) => visualStorageKey('question', H(n), 'image/png'));
    keys.forEach((k) => store.set(k, PNG));
    keys.forEach((k, i) =>
      dbState.relations.push({
        questionId: QID, role: 'exercise_context', status: 'active', consumers: null,
        occurrence: { id: `o${i}`, access: 'question', storageKey: k, readingOrder: 2 - i, groupKey: null, groupPart: null, identityText: null },
      }),
    );
    const q = { id: QID, contentText: TEXT, contentImages: ['/figures/legacy-p1.png'] };

    const student = (await visualKeysFor([q])).get(QID)!;
    const model = (await selectVisualsFor([q])).get(QID)!.keys;
    expect(student).toEqual(model);
    expect(student).toEqual([keys[1], keys[0]]); // reading order, not insertion order

    // Bytes: what the file route serves the student vs what the model is sent.
    sessionUser = { id: 'u1', role: 'student' };
    const { GET } = await import('@/app/api/files/[...key]/route');
    const served = await Promise.all(
      student.map(async (k) =>
        Buffer.from(await (await GET(new Request('http://x/api/files/' + k), { params: Promise.resolve({ key: k.split('/') }) })).arrayBuffer()),
      ),
    );
    const sent = await loadSourceFigures([{ id: QID, kind: 'question', label: 'Q', similarity: 1, text: '', images: model }]);
    expect(sent.images.map((i) => Buffer.from(i.base64, 'base64').toString('hex'))).toEqual(served.map((b) => b.toString('hex')));
  });
});

describe('deploy-order safety', () => {
  it('an unmigrated database degrades to the legacy page, and only for missing-table errors', async () => {
    const { db } = await import('@/lib/db');
    const { selectVisualsFor } = await import('@/lib/visual-evidence');
    const original = db.questionVisual.findMany;
    const q = { id: 'q-legacy', contentText: 'x', contentImages: ['/figures/p1.png'] };

    (db.questionVisual as { findMany: unknown }).findMany = async () => {
      throw Object.assign(new Error('relation does not exist'), { code: 'P2021' });
    };
    expect((await selectVisualsFor([q])).get('q-legacy')!.keys).toEqual(['/figures/p1.png']);

    (db.questionVisual as { findMany: unknown }).findMany = async () => {
      throw Object.assign(new Error('connection refused'), { code: 'P1001' });
    };
    await expect(selectVisualsFor([q])).rejects.toThrow('connection refused');

    (db.questionVisual as { findMany: unknown }).findMany = original;
  });
});
