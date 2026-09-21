import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { AiImage } from '@/lib/ai/types';
import type { RetrievalSource } from '@/lib/retrieval';
import { getObject } from '@/lib/storage';

/**
 * The figures a grounded answer is entitled to look at.
 *
 * WHY THIS EXISTS. `Question.content_images` reached the student's screen and
 * stopped there: retrieval never selected the column, so the tutor answered
 * circuit and titration questions from their captions. A student and the model
 * were reading different questions.
 *
 * WHAT IT WILL NOT DO.
 *
 *   It does not collect every image on the source paper. Only the figures of
 *   the sources actually handed to the answer are loaded — a neighbouring
 *   exercise's diagram is not evidence for this question, it is a distractor
 *   with the authority of having been sent.
 *
 *   It does not send an image twice. Keys are de-duplicated across sources
 *   before a byte is read, so a figure shared by two retrieved questions costs
 *   one load and one upload.
 *
 *   It does not invent a public URL. Both provider adapters take base64, so
 *   the bytes travel inside the request and nothing about this makes a secured
 *   asset reachable from the internet.
 */

/** How many figures one answer may carry, across all its sources. */
const MAX_FIGURES = 6;

/** Refuse anything absurd before it is base64'd into a request body. */
const MAX_BYTES = 5 * 1024 * 1024;

const MEDIA_TYPES: Record<string, AiImage['mediaType']> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export type FigureRef = {
  /**
   * The name the model is told, and the same name used in the text context.
   *
   * `AiRequest.images` is a flat list — both providers attach images to one
   * user message — so the only thing tying a picture to the question it
   * belongs to is this label appearing beside both. Deterministic and
   * 1-indexed, so "source 2, figure 1" reads the same to a person debugging it.
   */
  label: string;
  key: string;
  sourceIndex: number;
  /** The multi-panel document this image is one panel of, if any. */
  group?: { groupKey: string; size: number } | null;
};

export type LoadedFigures = {
  /** In the same order as `refs`, which is the order the labels are numbered. */
  images: AiImage[];
  refs: FigureRef[];
  /** Figures a source declared that could not be read. */
  failed: FigureRef[];
  /** Source indexes (1-based) that declared a figure and got none. */
  sourcesMissingEvidence: number[];
  /**
   * Source indexes whose multi-panel document could not be loaded whole. Its
   * loaded panels are withdrawn: half a document presented as the document is
   * worse than none, because it looks complete.
   */
  sourcesIncompleteEvidence: number[];
};

export const EMPTY_FIGURES: LoadedFigures = {
  images: [],
  refs: [],
  failed: [],
  sourcesMissingEvidence: [],
  sourcesIncompleteEvidence: [],
};

function mediaTypeFor(key: string): AiImage['mediaType'] | null {
  const ext = path.extname(key.split('?')[0] ?? '').toLowerCase();
  return MEDIA_TYPES[ext] ?? null;
}

/**
 * Bytes for one key, by the same rule the student's screen resolves it.
 *
 * `QuestionBody` treats a leading slash as a file published under `public/` —
 * exam-paper figures, which are published documents with no owner to check —
 * and anything else as an owned object behind the authenticated file route.
 * Read the same way here so the model cannot see a class of file the student
 * cannot, nor the reverse.
 *
 * A remote URL is deliberately NOT fetched. Nothing in this corpus should
 * still be pointing at someone else's CDN by the time it is answered from, and
 * quietly reaching out would turn an unnoticed data problem into a runtime
 * dependency on a third party.
 */
async function readFigure(key: string): Promise<Buffer | null> {
  if (key.startsWith('http://') || key.startsWith('https://')) return null;

  if (key.startsWith('/')) {
    const clean = path.normalize(key).replace(/^[/\\]+/, '');
    const full = path.join(process.cwd(), 'public', clean);
    // Normalised and re-checked: a key is data, and `..` in one must not walk
    // out of the published directory.
    const root = path.join(process.cwd(), 'public');
    if (!full.startsWith(root)) return null;
    return readFile(full);
  }

  return getObject(key);
}

/**
 * Loads the figures belonging to these sources, in order, de-duplicated.
 *
 * Sources are numbered from 1 in the order given, and so are each source's own
 * figures, because `formatFigureManifest` prints those same numbers into the
 * text the model reads.
 */
export async function loadSourceFigures(
  sources: RetrievalSource[],
  limit: number = MAX_FIGURES,
): Promise<LoadedFigures> {
  const planned: FigureRef[] = [];
  const seen = new Set<string>();
  const declaredBySource = new Map<number, number>();

  sources.forEach((source, index) => {
    const sourceIndex = index + 1;
    const keys = source.images ?? [];
    if (keys.length > 0) declaredBySource.set(sourceIndex, keys.length);

    keys.forEach((key, figureIndex) => {
      if (!key || seen.has(key)) return;
      seen.add(key);
      planned.push({
        label: `source_${sourceIndex}_figure_${figureIndex + 1}`,
        key,
        sourceIndex,
        group: source.imageGroups?.[figureIndex] ?? null,
      });
    });
  });

  const images: AiImage[] = [];
  const refs: FigureRef[] = [];
  const failed: FigureRef[] = [];

  for (const ref of planned) {
    if (images.length >= limit) {
      failed.push(ref);
      continue;
    }

    const mediaType = mediaTypeFor(ref.key);
    if (!mediaType) {
      failed.push(ref);
      continue;
    }

    try {
      const bytes = await readFigure(ref.key);
      if (!bytes || bytes.length === 0 || bytes.length > MAX_BYTES) {
        failed.push(ref);
        continue;
      }
      images.push({ base64: bytes.toString('base64'), mediaType });
      refs.push(ref);
    } catch {
      // The key, never the bytes. A figure that will not load is a fact worth
      // recording; its contents are not something to put in a log.
      failed.push(ref);
    }
  }

  /*
   * PANELS GO WHOLE OR NOT AT ALL. A group with any panel unloaded — a read
   * failure or the figure budget — has its loaded panels withdrawn and its
   * source named as carrying incomplete evidence.
   */
  const loadedPerGroup = new Map<string, number>();
  refs.forEach((r) => {
    if (r.group) {
      const k = `${r.sourceIndex}|${r.group.groupKey}`;
      loadedPerGroup.set(k, (loadedPerGroup.get(k) ?? 0) + 1);
    }
  });
  const brokenGroups = new Set<string>();
  for (const ref of [...refs, ...failed]) {
    if (!ref.group) continue;
    const k = `${ref.sourceIndex}|${ref.group.groupKey}`;
    if ((loadedPerGroup.get(k) ?? 0) < ref.group.size) brokenGroups.add(k);
  }
  const incompleteSources = new Set<number>();
  if (brokenGroups.size > 0) {
    for (let i = refs.length - 1; i >= 0; i -= 1) {
      const ref = refs[i]!;
      if (ref.group && brokenGroups.has(`${ref.sourceIndex}|${ref.group.groupKey}`)) {
        refs.splice(i, 1);
        images.splice(i, 1);
        failed.push(ref);
      }
    }
    for (const k of brokenGroups) incompleteSources.add(Number(k.split('|')[0]));
  }

  /*
   * A source that declared figures and got none has lost its evidence.
   *
   * Partial is still counted as present: a question with three documents and
   * two loaded can be reasoned about, and the manifest names exactly which
   * arrived. It is the source that got NOTHING that must not be answered as
   * though the figure never mattered.
   */
  const loadedBySource = new Set(refs.map((r) => r.sourceIndex));
  const sourcesMissingEvidence = [...declaredBySource.keys()]
    .filter((i) => !loadedBySource.has(i))
    .sort((a, b) => a - b);

  return {
    images,
    refs,
    failed,
    sourcesMissingEvidence,
    sourcesIncompleteEvidence: [...incompleteSources].sort((a, b) => a - b),
  };
}

/**
 * The block that ties each picture to the question it belongs to.
 *
 * Without it the model receives an anonymous pile: on a two-source answer it
 * cannot tell the circuit from the titration curve, and reading one against
 * the other produces a confident wrong answer with a figure to point at.
 */
export function formatFigureManifest(sources: RetrievalSource[], loaded: LoadedFigures): string {
  if (
    loaded.refs.length === 0 &&
    loaded.sourcesMissingEvidence.length === 0 &&
    loaded.sourcesIncompleteEvidence.length === 0
  ) {
    return '';
  }

  const lines: string[] = ['# Figures attached to this request'];

  for (const ref of loaded.refs) {
    const source = sources[ref.sourceIndex - 1];
    const label = source?.label ?? `source ${ref.sourceIndex}`;
    lines.push(`- ${ref.label} — belongs to SOURCE ${ref.sourceIndex} (${label})`);
  }

  for (const index of loaded.sourcesMissingEvidence) {
    const source = sources[index - 1];
    const label = source?.label ?? `source ${index}`;
    lines.push(
      `- SOURCE ${index} (${label}) prints a figure that could NOT be loaded. ` +
        'Do not answer as though you can see it.',
    );
  }

  for (const index of loaded.sourcesIncompleteEvidence) {
    if (loaded.sourcesMissingEvidence.includes(index)) continue;
    const source = sources[index - 1];
    const label = source?.label ?? `source ${index}`;
    lines.push(
      `- SOURCE ${index} (${label}) prints a multi-panel figure that could only be partly loaded; ` +
        'it is withheld. Do not answer as though you can see it.',
    );
  }

  lines.push(
    '',
    'Images are attached in the order listed above. Use a figure only for the ' +
      'source it belongs to.',
  );

  return lines.join('\n');
}

/**
 * The page the student photographed, as something the model can actually look at.
 *
 * `/api/upload` transcribes an uploaded page, pastes the TEXT into the message,
 * stores the image and shows it back on screen. What it never did was hand the
 * image to the model. So a student who photographed a physics problem sent a
 * transcript reading "The adjacent circuit includes…" and was answered with
 * "this question refers to 'adjacent circuit', which I do not have in front of
 * me" — true from the tutor's side, and maddening from theirs, because they had
 * just supplied it. Reported 2026-09-20 as "this is the img it should take
 * internal figures".
 *
 * OCR cannot carry a circuit diagram or a resonance curve. Only the picture can,
 * and the picture was already sitting in storage.
 *
 * ATTACHED ON EVERY TURN OF THE THREAD, not only the one after the upload. The
 * column holds the latest photo, which `/api/upload` documents as "the one the
 * next question is about", and a follow-up — "explain part b again" — names no
 * figure at all while still being entirely about the one on screen. Paying for
 * the image each turn is the cost of the tutor and the student looking at the
 * same page.
 *
 * Returns null for a PDF or a Word file: those were text all along, their text
 * was extracted at upload, and there is no picture to send.
 */
const IMAGE_TYPE_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export async function loadUploadedImage(key: string | null | undefined): Promise<AiImage | null> {
  if (!key) return null;

  const mediaType = IMAGE_TYPE_BY_EXT[path.extname(key).toLowerCase()];
  if (!mediaType) return null;

  try {
    const { toAiImage } = await import('@/lib/ocr');
    return toAiImage(await getObject(key), mediaType);
  } catch (err) {
    // A thread whose photo cannot be read still answers from its text. The
    // caveat about the missing figure comes back on its own, which is the
    // correct behaviour when the picture genuinely is not available.
    console.error('[figures] could not load the uploaded page', err);
    return null;
  }
}
