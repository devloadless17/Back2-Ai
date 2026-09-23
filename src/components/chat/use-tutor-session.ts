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
  /**
   * Set only when there is no question or attempt to anchor to — a chapter or
   * subject page, where the best the tutor can do is start scoped to the
   * right subject rather than asking which one. Applied with a second call
   * (`PATCH .../subject`, the same one `SubjectPicker` uses) rather than on
   * creation, because `POST /api/chat/sessions` never learned that field and
   * duplicating its ownership check there would be a second place for the two
   * to drift apart.
   */
  subjectId?: string;
  /**
   * What the dock showed as "Looking at: …" — sent on as the session's title,
   * and ONLY for the subject-only case above. A question already carries its
   * own text into the conversation via `questionId`; this is for the case
   * that had nothing to carry, where the label was the one thing on screen
   * naming what "this" meant. Stored so the chat page can open by asking
   * about it on the student's behalf, rather than landing them on an empty
   * box that still expects them to type the chapter name themselves.
   */
  label?: string;
};

export function useTutorSession() {
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);

  async function open(anchor: TutorAnchor = {}) {
    setOpening(true);
    setFailed(false);
    try {
      const unanchored = !anchor.questionId && !anchor.attemptId;
      const session = await sendJson<{ id: string }>('/api/chat/sessions', 'POST', {
        ...(anchor.attemptId ? { attemptId: anchor.attemptId } : {}),
        ...(anchor.questionId ? { questionId: anchor.questionId } : {}),
        ...(unanchored && anchor.label ? { title: anchor.label } : {}),
      });
      if (unanchored && anchor.subjectId) {
        await sendJson(`/api/chat/sessions/${session.id}/subject`, 'PATCH', {
          subjectId: anchor.subjectId,
        });
      }
      router.push(`/chat/${session.id}`);
    } catch {
      setFailed(true);
      setOpening(false);
    }
  }

  return { open, opening, failed };
}
