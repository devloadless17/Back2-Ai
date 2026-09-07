import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who the current request is spending for.
 *
 * There are two dozen places that call the model, across chat, grading,
 * flashcards, quizzes, OCR and ingestion. Passing the student down to each of
 * them means every future call site has to remember, and the one that forgets
 * leaves a hole in the meter that nothing reveals until the invoice arrives.
 *
 * So the request carries it instead. `route()` opens a store for every API
 * request, `apiUser()` fills in the student once it has resolved one, and the
 * provider wrapper reads it. A call made outside a request — a corpus script, a
 * cron job — finds no store, is recorded against no student, and is still
 * counted in the service total.
 *
 * The store is filled in after it is opened, which only works because it is one
 * mutable object shared by reference for the life of the request. Replacing it
 * with a fresh object would not propagate.
 */
export type MeterStore = { userId: string | null; kind: string };

const storage = new AsyncLocalStorage<MeterStore>();

/** Runs `fn` with a meter store the request can fill in later. */
export function withMeter<T>(kind: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ userId: null, kind }, fn);
}

/** Names the student this request is spending for. Called once, by `apiUser`. */
export function setMeterUser(userId: string): void {
  const store = storage.getStore();
  if (store) store.userId = userId;
}

/** Narrows what the current call is spending on — chat, marking, ocr. */
export function setMeterKind(kind: string): void {
  const store = storage.getStore();
  if (store) store.kind = kind;
}

export function currentMeter(): MeterStore | null {
  return storage.getStore() ?? null;
}
