'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { sendJson } from '@/lib/client/request';

/**
 * Opening a tutoring conversation, in one place.
 *
 * Both entry points to the tutor — the button beside a marked question and the
 * dock that follows a student around the app — create the same thing: a chat
 * session optionally anchored to a question, or to the student's own marked
 * attempt of it. Anchoring is the whole difference between "explain this
 * question" and "mark what I wrote against the correction key", and it is a
 * server-enforced pairing, so it must not be re-implemented per surface.
 *
 * `opening` gates the control, `failed` is a one-line message rather than a
 * thrown error: a tutor that cannot be reached is an inconvenience on a page
 * that is still perfectly usable without it.
 */
export type TutorAnchor = {
  questionId?: string;
  attemptId?: string;
};

export function useTutorSession() {
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);

  async function open(anchor: TutorAnchor = {}) {
    setOpening(true);
    setFailed(false);
    try {
      const session = await sendJson<{ id: string }>('/api/chat/sessions', 'POST', {
        ...(anchor.attemptId ? { attemptId: anchor.attemptId } : {}),
        ...(anchor.questionId ? { questionId: anchor.questionId } : {}),
      });
      router.push(`/chat/${session.id}`);
    } catch {
      setFailed(true);
      setOpening(false);
    }
  }

  return { open, opening, failed };
}
