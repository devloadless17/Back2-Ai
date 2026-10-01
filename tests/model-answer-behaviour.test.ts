import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * What actually happens when a question has no answer and no marking scheme.
 *
 * The prompt tests check wording; these check behaviour, and specifically the
 * two things that cost money or mislead a student: that a paid call happens
 * only when there is genuinely nothing stored, and that what comes back is
 * never mistaken for the ministry's.
 */

const m = {
  complete: vi.fn(),
  completeJson: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  grounding: vi.fn(),
  canSpend: vi.fn(),
};

vi.mock('@/lib/ai', () => ({
  ai: () => ({ complete: m.complete, completeJson: m.completeJson, verifyModel: 'mock' }),
  embed: vi.fn(),
}));
vi.mock('@/lib/env', () => ({ isAiConfigured: () => true }));
vi.mock('@/lib/retrieval', () => ({ retrieveGrounding: m.grounding }));
vi.mock('@/lib/db', () => ({
  db: {
    question: {
      findFirst: m.findFirst,
      findUnique: m.findUnique,
      findMany: m.findMany,
      updateMany: m.updateMany,
    },
  },
}));

const { modelSolutionFor } = await import('../src/lib/model-solution');
const { modelBaremeFor } = await import('../src/lib/model-bareme');

const QUESTION = '00000000-0000-4000-8000-000000000001';

const question = (over: Record<string, unknown> = {}) => ({
  contentText: 'Calculer la vitesse du mobile au point B.',
  contentLatex: null,
  sourcePassage: null,
  officialSolution: null,
  officialSolutionLatex: null,
  modelSolution: null,
  modelSolutionAt: null,
  contentImages: [],
  bareme: null,
  modelBareme: null,
  modelBaremeAt: null,
  _count: { visuals: 0 },
  chapter: { name: 'Cinématique', subjectId: 'sub-1', subject: { name: 'Physique', language: 'fr' } },
  ...over,
});

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.canSpend.mockResolvedValue(true);
  m.grounding.mockResolvedValue({ tier: 'concept', context: 'Le livre définit v = dx/dt.' });
  m.findMany.mockResolvedValue([]);
  m.updateMany.mockResolvedValue({ count: 1 });
});

describe('writing the answer to a question that came without one', () => {
  it('hands back the official answer without paying for anything', async () => {
    m.findFirst.mockResolvedValue(question({ officialSolution: 'v = 12 m/s' }));

    const result = await modelSolutionFor({ questionId: QUESTION, trackId: 't', userId: 'u', canSpend: m.canSpend });

    expect(result).toMatchObject({ status: 'ok', official: true, cached: true });
    expect(m.complete).not.toHaveBeenCalled();
    // Not even the budget is consulted: a stored answer must stay readable by a
    // student whose month is used up.
    expect(m.canSpend).not.toHaveBeenCalled();
  });

  it('reads a stored answer back rather than writing it again', async () => {
    m.findFirst.mockResolvedValue(question({ modelSolution: 'On applique v = dx/dt…', modelSolutionAt: new Date() }));

    const result = await modelSolutionFor({ questionId: QUESTION, trackId: 't', userId: 'u', canSpend: m.canSpend });

    expect(result).toMatchObject({ status: 'ok', official: false, cached: true });
    expect(m.complete).not.toHaveBeenCalled();
  });

  it('remembers a refusal so the same question is not paid for twice', async () => {
    // A question nobody can answer blind still costs a call the first time. The
    // empty string with a timestamp is what stops the second student paying it.
    m.findFirst.mockResolvedValue(question({ modelSolution: '', modelSolutionAt: new Date() }));

    const result = await modelSolutionFor({ questionId: QUESTION, trackId: 't', userId: 'u', canSpend: m.canSpend });

    expect(result).toEqual({ status: 'declined' });
    expect(m.complete).not.toHaveBeenCalled();
  });

  it('puts the course book and the passage in front of the model', async () => {
    m.findFirst.mockResolvedValue(question({ sourcePassage: 'Le mobile part de A sans vitesse initiale.' }));
    m.complete.mockResolvedValue({ text: 'v = 12 m/s', modelUsed: 'mock' });
    m.findUnique.mockResolvedValue({ modelSolution: 'v = 12 m/s' });

    await modelSolutionFor({ questionId: QUESTION, trackId: 't', userId: 'u', canSpend: m.canSpend });

    const sent = m.complete.mock.calls[0]![0];
    expect(sent.messages[0].content).toContain('Le livre définit v = dx/dt.');
    expect(sent.messages[0].content).toContain('Le mobile part de A sans vitesse initiale.');
    expect(sent.system).toMatch(/course book/i);
  });

  it('still answers when the course lookup fails', async () => {
    // Grounding is an improvement, not a precondition. An ungrounded answer is
    // worth more to a student than an error.
    m.findFirst.mockResolvedValue(question());
    m.grounding.mockRejectedValue(new Error('embeddings down'));
    m.complete.mockResolvedValue({ text: 'v = 12 m/s', modelUsed: 'mock' });
    m.findUnique.mockResolvedValue({ modelSolution: 'v = 12 m/s' });

    const result = await modelSolutionFor({ questionId: QUESTION, trackId: 't', userId: 'u', canSpend: m.canSpend });

    expect(result).toMatchObject({ status: 'ok' });
    expect(m.complete.mock.calls[0]![0].system).not.toMatch(/course book/i);
  });

  it('tells the model a figure exists, and forbids inventing its values', async () => {
    m.findFirst.mockResolvedValue(question({ _count: { visuals: 1 } }));
    m.complete.mockResolvedValue({ text: 'On lit v sur le graphe…', modelUsed: 'mock' });
    m.findUnique.mockResolvedValue({ modelSolution: 'On lit v sur le graphe…' });

    await modelSolutionFor({ questionId: QUESTION, trackId: 't', userId: 'u', canSpend: m.canSpend });

    expect(m.complete.mock.calls[0]![0].system).toMatch(/NEVER invent a number/);
  });

  it('refuses to spend when the student has no budget left', async () => {
    m.findFirst.mockResolvedValue(question());
    m.canSpend.mockResolvedValue(false);

    const result = await modelSolutionFor({ questionId: QUESTION, trackId: 't', userId: 'u', canSpend: m.canSpend });

    expect(result).toEqual({ status: 'needs_budget' });
    expect(m.complete).not.toHaveBeenCalled();
  });
});

describe('deciding the marking scheme for a question that came without one', () => {
  const bareme = [{ criterion: 'Écrire v = dx/dt', points: 1 }, { criterion: 'Calculer la valeur', points: 1 }];

  it('uses the ministry scheme when there is one, and pays nothing', async () => {
    m.findUnique.mockResolvedValue(question({ bareme }));

    const result = await modelBaremeFor({ questionId: QUESTION, userId: 'u', canSpend: m.canSpend });

    expect(result).toMatchObject({ status: 'ok', official: true, cached: true });
    expect(m.completeJson).not.toHaveBeenCalled();
  });

  it('reuses the stored scheme, so two students are marked the same way', async () => {
    // The whole point: the same criteria for everybody, not a fresh set per
    // attempt that scores identical answers differently.
    m.findUnique.mockResolvedValue(question({ modelBareme: bareme, modelBaremeAt: new Date() }));

    const first = await modelBaremeFor({ questionId: QUESTION, userId: 'u', canSpend: m.canSpend });
    const second = await modelBaremeFor({ questionId: QUESTION, userId: 'v', canSpend: m.canSpend });

    expect(first).toEqual(second);
    expect(first).toMatchObject({ status: 'ok', official: false, cached: true });
    expect(m.completeJson).not.toHaveBeenCalled();
  });

  it('never reports a generated scheme as official', async () => {
    m.findUnique
      .mockResolvedValueOnce(question())
      .mockResolvedValueOnce({ modelBareme: bareme });
    m.completeJson.mockResolvedValue({ data: { bareme }, modelUsed: 'mock' });

    const result = await modelBaremeFor({ questionId: QUESTION, userId: 'u', canSpend: m.canSpend });

    expect(result).toMatchObject({ status: 'ok', official: false, cached: false });
    // and it went to model_bareme, never to the ministry's column
    const written = m.updateMany.mock.calls[0]![0].data;
    expect(written).toHaveProperty('modelBareme');
    expect(written).not.toHaveProperty('bareme');
  });

  it('shows the model real schemes from the same subject as the pattern', async () => {
    m.findUnique.mockResolvedValueOnce(question()).mockResolvedValueOnce({ modelBareme: bareme });
    m.findMany.mockResolvedValue([{ bareme }, { bareme }]);
    m.completeJson.mockResolvedValue({ data: { bareme }, modelUsed: 'mock' });

    await modelBaremeFor({ questionId: QUESTION, userId: 'u', canSpend: m.canSpend });

    const sent = m.completeJson.mock.calls[0]![0];
    expect(sent.messages[0].content).toMatch(/Real marking schemes from this subject/i);
    expect(sent.system).toMatch(/Follow their shape/i);
  });

  it('remembers a refusal instead of asking again for every student', async () => {
    m.findUnique.mockResolvedValueOnce(question()).mockResolvedValueOnce({ modelBareme: [] });
    m.completeJson.mockResolvedValue({ data: { bareme: [] }, modelUsed: 'mock' });

    const result = await modelBaremeFor({ questionId: QUESTION, userId: 'u', canSpend: m.canSpend });

    expect(result).toEqual({ status: 'declined' });
    expect(m.updateMany.mock.calls[0]![0].data.modelBareme).toEqual([]);
  });

  it('holds the total to the marks printed on the paper', async () => {
    m.findUnique.mockResolvedValueOnce(question()).mockResolvedValueOnce({ modelBareme: bareme });
    m.completeJson.mockResolvedValue({ data: { bareme }, modelUsed: 'mock' });

    await modelBaremeFor({ questionId: QUESTION, userId: 'u', statedMarks: 7, canSpend: m.canSpend });

    expect(m.completeJson.mock.calls[0]![0].system).toContain('out of 7');
  });
});
