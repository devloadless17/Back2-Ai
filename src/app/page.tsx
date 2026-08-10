import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/session';

/**
 * Root entry. There is no marketing page — this product is entered either as a
 * signed-in student or at the sign-in form.
 */
export default async function RootPage() {
  const session = await getSession();
  redirect(session ? '/dashboard' : '/login');
}
