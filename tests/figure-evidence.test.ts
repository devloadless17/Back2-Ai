import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * A question's figures reaching the model.
 *
 * WHY THIS EXISTS. `Question.content_images` reached the student's screen and
 * stopped there: the retrieval SQL never selected the column, so the tutor
 * answered circuit and titration questions from their captions while the
 * diagram sat on the page in front of the student. A student and the model
 * were reading different questions.
 *
 * These tests pin the evidence pipeline, not the model's words. The assertion
 * worth making is "the picture arrived, attached to the right question" — what
 * the model then says about it is not something a unit test can own.
 */

// `public/` is read directly for published exam figures, the same rule
// `QuestionBody` uses on screen. A temporary cwd keeps that real rather than
// mocked: the path handling is half of what could be wrong.
const ROOT = mkdtempSync(path.join(tmpdir(), 'bac2-figures-'));
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const storage = new Map<string, Buffer>();

vi.mock('@/lib/storage', () => ({
  getObject: async (key: string) => {
    const hit = storage.get(key);
    if (!hit) throw new Error('not found');
    return hit;
  },
}));

let loadSourceFigures: typeof import('@/lib/figures').loadSourceFigures;
let formatFigureManifest: typeof import('@/lib/figures').formatFigureManifest;
let cwd: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  mkdirSync(path.join(ROOT, 'public', 'figures'), { recursive: true });
  writeFileSync(path.join(ROOT, 'public', 'figures', 'circuit.png'), PNG);
  writeFileSync(path.join(ROOT, 'public', 'figures', 'graph.png'), PNG);
  storage.set('uploads/u1/owned.png', PNG);

  cwd = vi.spyOn(process, 'cwd').mockReturnValue(ROOT);
  const mod = await import('@/lib/figures');
  loadSourceFigures = mod.loadSourceFigures;
  formatFigureManifest = mod.formatFigureManifest;
});

afterAll(() => {
  cwd.mockRestore();
  rmSync(ROOT, { recursive: true, force: true });
});

type Source = import('@/lib/retrieval').RetrievalSource;

const source = (over: Partial<Source> = {}): Source => ({
  id: 'q1',
  kind: 'question',
  label: 'Electric circuits — past question',
  similarity: 0.9,
  text: 'The adjacent figure represents an RLC circuit.',
  ...over,
});

describe('figures belonging to a retrieved source', () => {
  it('loads a published exam figure and labels it with its source', async () => {
    const loaded = await loadSourceFigures([source({ images: ['/figures/circuit.png'] })]);

    expect(loaded.images).toHaveLength(1);
    expect(loaded.images[0]!.mediaType).toBe('image/png');
    expect(loaded.images[0]!.base64.length).toBeGreaterThan(0);
    expect(loaded.refs[0]!.label).toBe('source_1_figure_1');
    expect(loaded.sourcesMissingEvidence).toEqual([]);
  });

  it('loads an owned asset through storage, not from disk', async () => {
    const loaded = await loadSourceFigures([source({ images: ['uploads/u1/owned.png'] })]);
    expect(loaded.images).toHaveLength(1);
    expect(loaded.failed).toEqual([]);
  });

  it('keeps several figures in the order the paper prints them', async () => {
    const loaded = await loadSourceFigures([
      source({ images: ['/figures/circuit.png', '/figures/graph.png'] }),
    ]);

    // Deterministic order matters: "the figure below" means the first one.
    expect(loaded.refs.map((r) => r.label)).toEqual([
      'source_1_figure_1',
      'source_1_figure_2',
    ]);
    expect(loaded.images).toHaveLength(2);
  });

  it('does not send the same key twice', async () => {
    const loaded = await loadSourceFigures([
      source({ id: 'a', images: ['/figures/circuit.png'] }),
      source({ id: 'b', images: ['/figures/circuit.png', '/figures/graph.png'] }),
    ]);

    expect(loaded.images).toHaveLength(2);
    expect(loaded.refs.map((r) => r.key)).toEqual([
      '/figures/circuit.png',
      '/figures/graph.png',
    ]);
  });

  it('gives a text-only source no images', async () => {
    const loaded = await loadSourceFigures([
      source({ kind: 'content_chunk', label: 'Ohm’s law — definition' }),
    ]);
    expect(loaded.images).toEqual([]);
    expect(loaded.refs).toEqual([]);
    expect(loaded.sourcesMissingEvidence).toEqual([]);
  });

  it('does not reach out to a remote url', async () => {
    const loaded = await loadSourceFigures([
      source({ images: ['https://cdn.mathpix.com/cropped/whatever.jpg'] }),
    ]);
    expect(loaded.images).toEqual([]);
    expect(loaded.failed).toHaveLength(1);
  });

  it('refuses a key that escapes the published directory', async () => {
    const loaded = await loadSourceFigures([source({ images: ['/../../secrets.png'] })]);
    expect(loaded.images).toEqual([]);
    expect(loaded.failed).toHaveLength(1);
  });
});

describe('when the evidence cannot be loaded', () => {
  it('reports the source as having lost its evidence', async () => {
    const loaded = await loadSourceFigures([source({ images: ['/figures/gone.png'] })]);

    expect(loaded.images).toEqual([]);
    expect(loaded.failed).toHaveLength(1);
    // This is what the answering path reads to decide whether to warn.
    expect(loaded.sourcesMissingEvidence).toEqual([1]);
  });

  it('counts a partial load as evidence present, naming what arrived', async () => {
    const loaded = await loadSourceFigures([
      source({ images: ['/figures/circuit.png', '/figures/gone.png'] }),
    ]);

    expect(loaded.images).toHaveLength(1);
    expect(loaded.failed).toHaveLength(1);
    // One of two is still something to reason from; the manifest says which.
    expect(loaded.sourcesMissingEvidence).toEqual([]);
  });

  it('tells the model plainly when a source lost its figure', async () => {
    const sources = [source({ images: ['/figures/gone.png'] })];
    const loaded = await loadSourceFigures(sources);
    const manifest = formatFigureManifest(sources, loaded);

    expect(manifest).toContain('could NOT be loaded');
    expect(manifest).toContain('Do not answer as though you can see it');
  });
});

describe('provenance in the text context', () => {
  it('ties each figure to the source it belongs to', async () => {
    const sources = [
      source({ id: 'a', label: 'Electric circuits — past question', images: ['/figures/circuit.png'] }),
      source({ id: 'b', label: 'Kinematics — past question', images: ['/figures/graph.png'] }),
    ];
    const loaded = await loadSourceFigures(sources);
    const manifest = formatFigureManifest(sources, loaded);

    expect(manifest).toContain('source_1_figure_1 — belongs to SOURCE 1 (Electric circuits');
    expect(manifest).toContain('source_2_figure_1 — belongs to SOURCE 2 (Kinematics');
    expect(manifest).toContain('Use a figure only for the source it belongs to');
  });

  it('is empty when there is nothing to say', async () => {
    const sources = [source({ kind: 'content_chunk' })];
    const loaded = await loadSourceFigures(sources);
    expect(formatFigureManifest(sources, loaded)).toBe('');
  });
});
