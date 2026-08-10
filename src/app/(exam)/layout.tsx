import { requireSession } from '@/lib/auth/guards';

/**
 * Examination shell.
 *
 * No sidebar, no navigation, no notification badges. This is the one mode where
 * the app deliberately stops being an app the student can wander around in: the
 * only way out is to submit, or to leave. The friendly-tutor register recedes
 * here and the layout is the first thing that says so.
 */
export default async function ExamLayout({ children }: { children: React.ReactNode }) {
  await requireSession();

  return (
    <div className="min-h-dvh bg-paper-sunken">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">{children}</div>
    </div>
  );
}
