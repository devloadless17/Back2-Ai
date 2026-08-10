import 'server-only';

import { ai, type AiImage } from '@/lib/ai';
import { AiError } from '@/lib/ai/types';

/**
 * OCR / document understanding.
 *
 * Implemented against the multimodal model rather than a dedicated OCR service,
 * for one reason that matters here: this corpus is handwritten mathematics and
 * scanned French/Arabic exam papers. Classical OCR returns `x2 + 3x - 4` for a
 * quadratic and loses every fraction, integral sign and diagram reference —
 * which then poisons the barème marking downstream. A vision model transcribes
 * the notation *as notation*.
 *
 * OCR_PROVIDER exists in env so a dedicated service can be slotted in later
 * without touching call sites.
 */

const TRANSCRIPTION_SYSTEM = [
  'You transcribe photographed or scanned examination material into Markdown with LaTeX.',
  '',
  'Rules:',
  '- Transcribe what is on the page. Do not solve, correct, complete, or comment on it.',
  '- Mathematics goes in LaTeX: inline as $...$, displayed as $$...$$. Preserve fractions,',
  '  integrals, vectors, subscripts and units exactly as written.',
  '- Preserve the original language (French, English or Arabic). Do not translate.',
  '- Preserve numbering and structure (1., a), i., etc.) as Markdown.',
  '- Where a diagram or figure appears, write a line: [figure: short description of what it shows].',
  '- If part of the page is genuinely illegible, write [illegible] at that point rather than guessing',
  '  at what it might say. A wrong guess is worse than a gap here.',
  '- Output the transcription only. No preamble, no "Here is the text".',
].join('\n');

export type OcrResult = {
  text: string;
  modelUsed: string;
  /** True when the model marked any part of the page unreadable. */
  hasIllegibleRegions: boolean;
};

export function toAiImage(bytes: Buffer, contentType: string): AiImage {
  const mediaType = normalizeMediaType(contentType);
  return { base64: bytes.toString('base64'), mediaType };
}

function normalizeMediaType(contentType: string): AiImage['mediaType'] {
  switch (contentType) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
    case 'image/gif':
      return contentType;
    case 'image/jpg':
      return 'image/jpeg';
    default:
      throw new AiError(`Unsupported image type "${contentType}".`);
  }
}

/**
 * Transcribes one image.
 *
 * `context` is optional framing — for an exam answer it is the question being
 * answered, which measurably improves notation choices (the model knows whether
 * a scrawled symbol is a `v` or a `\nu` when it knows the question is about
 * frequency).
 */
export async function transcribeImage(
  image: AiImage,
  context?: { questionText?: string; subject?: string },
): Promise<OcrResult> {
  const framing: string[] = [];
  if (context?.subject) framing.push(`Subject: ${context.subject}`);
  if (context?.questionText) {
    framing.push('This page is a student\'s work on the following question:', context.questionText);
  }

  const response = await ai().complete({
    system: TRANSCRIPTION_SYSTEM,
    images: [image],
    messages: [
      {
        role: 'user',
        content: framing.length > 0 ? `${framing.join('\n')}\n\nTranscribe the page.` : 'Transcribe the page.',
      },
    ],
    effort: 'medium',
    maxTokens: 8000,
  });

  if (response.refused) {
    throw new AiError('The provider declined to transcribe this image.');
  }

  return {
    text: response.text.trim(),
    modelUsed: response.modelUsed,
    hasIllegibleRegions: /\[illegible\]/i.test(response.text),
  };
}

/**
 * Extracts text from an uploaded reference document.
 *
 * PDFs are not parsed here — a PDF text layer is extracted by the ingestion
 * script, and a scanned PDF has no text layer at all. This handles the image
 * and plain-text cases the upload routes accept.
 */
export async function extractDocumentText(bytes: Buffer, contentType: string): Promise<string> {
  if (contentType === 'text/plain') {
    return bytes.toString('utf8').slice(0, 200_000);
  }

  if (contentType === 'application/pdf') {
    return extractPdfText(bytes);
  }

  const result = await transcribeImage(toAiImage(bytes, contentType));
  return result.text;
}

/**
 * Minimal PDF text-layer extraction.
 *
 * Pulls text from uncompressed and Flate-compressed content streams. This is
 * intentionally simple: it handles the digitally-produced PDFs students upload
 * from their school portals, and returns an empty string for scanned PDFs
 * rather than pretending to succeed. The caller treats an empty result as
 * "needs OCR" and says so, instead of silently storing a blank document.
 */
async function extractPdfText(bytes: Buffer): Promise<string> {
  const { inflateSync } = await import('node:zlib');
  const raw = bytes.toString('latin1');
  const pieces: string[] = [];

  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamPattern.exec(raw)) !== null) {
    const chunk = Buffer.from(match[1] ?? '', 'latin1');
    let text: string;

    try {
      text = inflateSync(chunk).toString('latin1');
    } catch {
      text = chunk.toString('latin1');
    }

    // Text-showing operators: (literal) Tj  and  [(a) -2 (b)] TJ
    const showPattern = /\((?:\\.|[^\\()])*\)/g;
    let show: RegExpExecArray | null;
    const line: string[] = [];

    while ((show = showPattern.exec(text)) !== null) {
      const literal = show[0]
        .slice(1, -1)
        .replace(/\\([()\\])/g, '$1')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\t/g, ' ');
      if (literal.trim().length > 0) line.push(literal);
    }

    if (line.length > 0) pieces.push(line.join(''));
  }

  return pieces.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 200_000);
}
