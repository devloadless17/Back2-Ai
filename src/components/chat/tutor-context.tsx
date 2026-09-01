'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * What the tutor is looking at, published by the page and read by the dock.
 *
 * The dock is mounted once in the `(app)` layout so it survives navigation, and
 * that is exactly why it cannot see the page: a layout does not re-render when
 * the route below it changes, and it has no access to that route's data anyway.
 * Without this the dock was global and blind — it followed the student
 * everywhere and could only ever offer "start a fresh conversation", so the one
 * thing a tutor beside you is for, knowing what is on the screen, was the one
 * thing it could not do.
 *
 * So the page publishes and the dock subscribes. `TutorAnchor` is rendered by
 * the page — a server component can render it, since it takes only plain
 * strings — and it registers on mount and withdraws on unmount. Withdrawing
 * matters more than registering: a stale anchor means the tutor claims to be
 * looking at a chapter the student left two screens ago, which is worse than
 * admitting it has nothing.
 */

export type TutorPageContext = {
  /** What the tutor is looking at, in the student's own words. */
  label: string;
  questionId?: string;
  attemptId?: string;
};

type Store = {
  context: TutorPageContext | null;
  publish: (value: TutorPageContext | null) => void;
};

const TutorContextStore = createContext<Store>({ context: null, publish: () => {} });

export function TutorContextProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<TutorPageContext | null>(null);
  const value = useMemo<Store>(() => ({ context, publish: setContext }), [context]);
  return <TutorContextStore.Provider value={value}>{children}</TutorContextStore.Provider>;
}

export function useTutorContext(): TutorPageContext | null {
  return useContext(TutorContextStore).context;
}

/**
 * Publishes this page's anchor for as long as the page is mounted.
 *
 * Renders nothing. The dependency list is the fields rather than the object so
 * a page that rebuilds an identical anchor on every render does not republish
 * it on every render — which would loop, since publishing sets state in a
 * provider above.
 */
export function TutorAnchor({ label, questionId, attemptId }: TutorPageContext) {
  const { publish } = useContext(TutorContextStore);

  useEffect(() => {
    publish({ label, questionId, attemptId });
    return () => publish(null);
  }, [publish, label, questionId, attemptId]);

  return null;
}
