import { fail, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getObject, ownerFromKey } from '@/lib/storage';

/**
 * Serves stored objects.
 *
 * Everything in storage is either a student's own exam work or a private
 * document they uploaded, so there are no public URLs anywhere in this system.
 * Ownership is checked twice — once from the key's own shape, once against the
 * row that references it — because these two can disagree only if something has
 * gone wrong, and when they do the correct answer is to serve nothing.
 */
export const GET = route(async (_request, context: { params: Promise<{ key: string[] }> }) => {
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const { key: segments } = await context.params;
  const key = segments.join('/');
  const scope = segments[0];

  if (!scope) return fail(404, 'NOT_FOUND');

  // Official-solution visuals are never served here, whatever the key: only
  // `/api/visuals/solution/[occurrenceId]` serves them, and only after the
  // student has submitted. Stated outright rather than left to the key having
  // no owner segment.
  if (scope === 'solution-images' && user.role !== 'admin') return fail(404, 'NOT_FOUND');

  // Question images are curriculum content: any signed-in student may read them.
  if (scope !== 'question-images') {
    const owner = ownerFromKey(key);
    const isOwner = owner === user.id;
    const isAdmin = user.role === 'admin';

    if (!isOwner && !isAdmin) return fail(404, 'NOT_FOUND');

    // Second check: an object is only readable if a row the student owns still
    // points at it. A deleted reference stops being readable immediately.
    if (!isAdmin) {
      const referenced = await isReferencedByUser(key, user.id);
      if (!referenced) return fail(404, 'NOT_FOUND');
    }
  }

  let bytes: Buffer;
  try {
    bytes = await getObject(key);
  } catch {
    return fail(404, 'NOT_FOUND');
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': contentTypeFor(key),
      'content-length': String(bytes.byteLength),
      // Private and short-lived: this is one student's work.
      'cache-control': 'private, max-age=300',
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
    },
  });
});

async function isReferencedByUser(key: string, userId: string): Promise<boolean> {
  const [reference, answer, chatSession] = await Promise.all([
    db.userReference.findFirst({ where: { userId, fileUrl: key }, select: { id: true } }),
    db.examAnswer.findFirst({
      where: { photoUrl: key, examSimulationQuestion: { examSimulation: { userId } } },
      select: { id: true },
    }),
    db.chatSession.findFirst({ where: { userId, uploadedImageUrl: key }, select: { id: true } }),
  ]);

  return Boolean(reference || answer || chatSession);
}

function contentTypeFor(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
    case 'txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}
