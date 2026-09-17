import { permanentRedirect } from 'next/navigation';

import { todosRedirectTarget } from '@/lib/todos-redirect';

/**
 * `/todos` is gone. The planning page carries the backlog now.
 *
 * Todos still exist as a distinct persisted thing — undated intention, as
 * opposed to a dated session — and nothing about that changed. What changed is
 * where they are read: beside the week they are eventually meant to join,
 * rather than on a route of their own that nothing else ever linked to.
 *
 * Stays for bookmarks. Every link inside the application points at
 * `/schedule`.
 */
export default async function TodosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  permanentRedirect(todosRedirectTarget(await searchParams));
}
