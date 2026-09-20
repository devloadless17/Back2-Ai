import { describe, expect, it } from 'vitest';

import { loadUploadedImage } from '@/lib/figures';

/**
 * "this is the img it should take internal figures" — 2026-09-20.
 *
 * A student photographed a physics problem and uploaded it. `/api/upload`
 * transcribed the page, pasted the TEXT into the message, stored the image and
 * displayed it back. The model was never given the picture, so it read "The
 * adjacent circuit includes…" and answered that it did not have the circuit —
 * which the student had just supplied. OCR carries words; it cannot carry a
 * circuit diagram or a resonance curve.
 */

describe('the page the student uploaded', () => {
  it('is nothing to send when the thread has no upload', async () => {
    await expect(loadUploadedImage(null)).resolves.toBeNull();
    await expect(loadUploadedImage(undefined)).resolves.toBeNull();
    await expect(loadUploadedImage('')).resolves.toBeNull();
  });

  /**
   * The extension gate runs BEFORE storage is touched, which is what makes
   * this testable without a bucket — and is also the point. A PDF or a Word
   * file was text all along: its text was extracted at upload, and handing its
   * bytes to a vision model as though they were a picture would be a decode
   * error at best and a charge for nothing at worst.
   */
  it('refuses to treat a document as a picture', async () => {
    await expect(loadUploadedImage('chat/user-1/abc.pdf')).resolves.toBeNull();
    await expect(loadUploadedImage('chat/user-1/abc.docx')).resolves.toBeNull();
    await expect(loadUploadedImage('chat/user-1/abc.txt')).resolves.toBeNull();
    // No extension at all: unknowable, so not guessed at.
    await expect(loadUploadedImage('chat/user-1/abc')).resolves.toBeNull();
  });

  it('accepts the formats the uploader actually offers', async () => {
    // These reach storage, which is absent here, so the loader must fall back
    // to null rather than throwing — a thread whose photo cannot be read still
    // has to answer from its text.
    for (const key of ['a.png', 'a.jpg', 'a.jpeg', 'a.webp', 'A.PNG']) {
      await expect(loadUploadedImage(`chat/user-1/${key}`)).resolves.toBeNull();
    }
  });
});
