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
      {/* A printed-page header rule, echoing the top of an exam booklet. */}
      <header className="border-b border-rule bg-paper-raised">
        <div className="mx-auto flex w-full max-w-5xl items-center px-6 py-4">
          <span className="font-serif text-lg font-semibold">Bac II</span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-md animate-fade-up">{children}</div>
      </main>
    </div>
  );
}
