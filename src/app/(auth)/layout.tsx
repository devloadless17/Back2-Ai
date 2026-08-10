import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/session';

/**
 * Signed-out shell for login and signup.
 *
 * An already-authenticated visitor is sent to the dashboard rather than being
 * shown a sign-in form for the account they are already using.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session) redirect('/dashboard');

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-rule bg-paper-raised/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2.5 px-6 py-4">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 animate-float items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-base font-extrabold text-on-primary shadow-pop"
          >
            B
          </span>
          <span className="text-lg font-extrabold tracking-tight">Bac II</span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-md animate-rise">{children}</div>
      </main>
    </div>
  );
}
