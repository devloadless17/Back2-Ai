import 'server-only';

import { ai, type AiImage } from '@/lib/ai';
import { AiError } from '@/lib/ai/types';
import { repairSymbolFont } from '@/lib/symbol-font';

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
  if (
    contentType === 'text/plain' ||
    contentType === 'application/pdf' ||
    contentType === DOCX_TYPE
  ) {
    const parsed =
      contentType === 'text/plain'
        ? bytes.toString('utf8').slice(0, 200_000)
        : contentType === 'application/pdf'
          ? await extractPdfText(bytes)
          : await extractDocxText(bytes);

    /*
     * A PARSE THAT PRODUCED BYTES IS NOT A PARSE THAT PRODUCED A DOCUMENT.
     *
     * Applied here rather than in the two routes so they cannot drift, and so
     * the existing contract holds: empty already means "could not read", and
     * both callers know how to report that. What changes is that a reader
     * returning the inside of the file — font names, locale tags, binary — now
     * counts as not having read it, instead of being stored and embedded as the
     * student's own material. See `looksLikeText`.
     */
    if (parsed.length > 0 && !looksLikeText(parsed)) {
      console.error(
        `[ocr] discarded ${contentType} output: ${parsed.length} chars at ` +
          `language ratio ${languageRatio(parsed).toFixed(3)} (floor ${MIN_LANGUAGE_RATIO})`,
      );
      return '';
    }

    return parsed;
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
 * Hand-rolled for the same reason the password hashing is: one more npm package
 * in the dependency tree of a product that handles students' own documents is a
 * cost, and this is forty lines.
 *
 * The PDF reader used to be hand-rolled on the same argument and is not any
 * more — see `extractPdfText`. The difference is that a .docx is a ZIP holding
 * UTF-8 XML, so reading it needs no font or encoding knowledge, while a PDF's
 * text is meaningless without its ToUnicode CMap. Forty lines is enough for one
 * and cannot be enough for the other. Measured, not assumed: this reader was
 * never the one failing.
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
 * PDF text-layer extraction, via pdfjs (bundled by `unpdf`).
 *
 * THIS REPLACED A HAND-ROLLED READER, and the measurement is the reason.
 * Both were run over the same 60 real Lebanese exam PDFs and compared against
 * an independent reader (pdfplumber):
 *
 *     hand-rolled   0 / 60 readable
 *     pdfjs        60 / 60 readable
 *
 * The old one scraped `(...)` literals out of every stream in the file, so it
 * had three unfixable problems. It had no font encoding or ToUnicode CMap, so
 * Identity-H — the standard encoding for Arabic and for any subset font — came
 * out as latin1 noise. It scraped font programs and metadata alongside content,
 * so documents arrived as "IdentityAdobeTimes New Roman" and "fr-FRar-SA". And
 * when `inflateSync` failed on an image stream it fell back to reading raw
 * binary as text. Worse than failing: 44 of those 60 produced enough bytes to
 * clear the caller's length check, so they were stored and embedded as the
 * student's own handout.
 *
 * A dependency was accepted here against this codebase's usual preference
 * because the missing piece is CMap and font-encoding support. That is not
 * forty lines, and without it Arabic PDFs cannot work at all — which rules out
 * the format teachers most often circulate.
 *
 * Still returns empty for a scanned PDF with no text layer. The caller treats
 * empty as "needs OCR" and tells the student to photograph the page.
 */
async function extractPdfText(bytes: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');

  /*
   * `verbosity: 0` keeps pdfjs's font diagnostics out of the logs. It prints
   * "Warning: TT: undefined function" per glyph on these papers — hundreds of
   * lines for one upload that read perfectly — and a log nobody can scan is a
   * log that hides the next real error.
   */
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  const { text } = await extractText(pdf, { mergePages: true });
  const merged = Array.isArray(text) ? text.join('\n') : text;

  /*
   * THE SYMBOL-FONT REPAIR THE CORPUS PIPELINE ALREADY DOES, applied here too.
   *
   * Lebanese papers set their mathematics in Adobe Symbol, which a PDF embeds
   * at `0xF000 + byte` — inside the Private Use Area, where nothing downstream
   * can read it. Measured on one GS maths paper uploaded through this route:
   * 625 such codepoints, every one of them a Δ, √, ∑ or = that reached the
   * student as a blank box and the embedding as noise.
   *
   * `repairSymbolFont` was written for the corpus loader and nothing on the
   * upload path called it, so a student attaching the same paper their school
   * circulates got the damaged copy while the library held the repaired one.
   */
  const repaired = repairSymbolFont(merged);

  return repaired
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 200_000);
}

/**
 * Whether extracted text is running text rather than the inside of a file.
 *
 * WHY A RATIO AND NOT A LENGTH. The callers used to accept anything over ten
 * or twenty characters, and a broken reader clears that trivially: font names,
 * locale tags and raw binary are all long. A document that fails this is not
 * merely useless — it is stored in the student's list looking usable, embedded
 * into tier-3 retrieval, and searched against when they ask a question.
 *
 * THE THRESHOLD IS MEASURED, not chosen. Over 60 real PDFs read correctly and
 * the same 60 read by the old extractor:
 *
 *     real documents      lowest 0.798   median 0.992
 *     extractor garbage   p10    0.186   median 0.356
 *
 * 0.70 sits in the gap. It kept all 60 real documents and rejected 40 of the
 * 44 garbage ones. Raising it starts discarding real Arabic papers, which carry
 * more bracket and punctuation characters than French or English ones, for very
 * little extra reach.
 *
 * Deliberately NOT a printable-character test: "IdentityAdobeTimes New Roman"
 * is entirely printable and entirely not somebody's handout.
 */
const TEXT_PUNCTUATION = new Set(
  ".,;:!?()[]{}'\"-+=*/%<>@#&_|~^$–—‘’“”°±×÷€£",
);

export const MIN_LANGUAGE_RATIO = 0.7;

export function languageRatio(text: string): number {
  if (text.length === 0) return 0;
  let ok = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    // Private-use codepoints are the signature of a subset font read as bytes,
    // and control characters never belong to a document's prose.
    if ((code >= 0xe000 && code <= 0xf8ff) || code < 9) continue;
    if (/\p{L}|\p{N}/u.test(char) || /\s/.test(char) || TEXT_PUNCTUATION.has(char)) ok += 1;
  }
  return ok / text.length;
}

export function looksLikeText(text: string): boolean {
  return languageRatio(text) >= MIN_LANGUAGE_RATIO;
}
