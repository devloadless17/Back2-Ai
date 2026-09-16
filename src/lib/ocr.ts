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

export const DOCX_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Extracts text from an uploaded reference document.
 *
 * Text and Word files are read directly. A PDF is tried for its text layer and
 * returns empty when it has none, which is a scan — the caller treats empty as
 * "needs OCR" and says so rather than storing a blank document. Anything else
 * is an image and goes to the model.
 */
export async function extractDocumentText(bytes: Buffer, contentType: string): Promise<string> {
  if (contentType === 'text/plain') {
    return bytes.toString('utf8').slice(0, 200_000);
  }

  if (contentType === 'application/pdf') {
    return extractPdfText(bytes);
  }

  if (contentType === DOCX_TYPE) {
    return extractDocxText(bytes);
  }

  const result = await transcribeImage(toAiImage(bytes, contentType));
  return result.text;
}

/**
 * Text from a .docx, without a dependency.
 *
 * A .docx is a ZIP whose `word/document.xml` holds the prose. Only that entry
 * is read: headers, footers, comments and tracked-change history are in other
 * parts of the archive and a student's handout is not improved by having its
 * footer interleaved into the body.
 *
 * The archive is walked by its local file headers rather than its central
 * directory. That is the simpler half of the format and enough for files
 * Word itself writes; a ZIP64 archive or one with a data descriptor instead of
 * sizes in the header will not be found, and the function returns empty rather
 * than guessing. Empty means "could not read", which the caller already knows
 * how to report — the same contract `extractPdfText` has for a scan.
 *
 * Hand-rolled for the same reason the PDF reader and the password hashing are:
 * one more npm package in the dependency tree of a product that handles
 * students' own documents is a cost, and this is forty lines.
 */
async function extractDocxText(bytes: Buffer): Promise<string> {
  const { inflateRawSync } = await import('node:zlib');

  const SIGNATURE = 0x04034b50;
  let offset = 0;

  while (offset + 30 <= bytes.length) {
    if (bytes.readUInt32LE(offset) !== SIGNATURE) break;

    const method = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = bytes.toString('utf8', nameStart, nameStart + nameLength);
    const dataStart = nameStart + nameLength + extraLength;

    // A zero compressed size here means the sizes were written to a trailing
    // data descriptor instead. Walking past it would need the central
    // directory, so stop rather than read the wrong bytes.
    if (compressedSize === 0) break;

    if (name === 'word/document.xml') {
      const data = bytes.subarray(dataStart, dataStart + compressedSize);
      let xml: string;
      try {
        xml = (method === 0 ? data : inflateRawSync(data)).toString('utf8');
      } catch {
        return '';
      }
      return docxXmlToText(xml).slice(0, 200_000);
    }

    offset = dataStart + compressedSize;
  }

  return '';
}

/**
 * The prose out of WordprocessingML.
 *
 * Paragraph and line breaks are turned into real newlines BEFORE the tags are
 * stripped. Stripping first would run every paragraph of a handout into one
 * line, and the chunker downstream splits on structure — so a document that
 * arrived as one line would be stored as one enormous passage and retrieved as
 * all-or-nothing.
 */
function docxXmlToText(xml: string): string {
  return xml
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
