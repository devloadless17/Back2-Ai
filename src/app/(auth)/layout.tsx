import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/session';

/**
 * Signed-out shell for login and signup.
 *
 * An already-authenticated visitor is sent to the dashboard rather than being
 * shown a sign-in form for the account they are already using.
 *
 * Deliberately thin. It used to centre everything in a 28rem column under a
 * shared header bar, which suited a single sheet and nothing else — the sign-in
 * screen is now a two-column split running the full height of the window, and
 * the signup wizard wants a wider single column with its own brand line. A
 * layout cannot serve both by parameterising a max-width, so it serves neither
 * and each page owns its own frame.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session) redirect('/dashboard');

  return <div className="min-h-dvh bg-paper">{children}</div>;
}
