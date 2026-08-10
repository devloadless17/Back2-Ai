import { requireSession } from '@/lib/auth/guards';

/**
 * Examination shell.
 *
 * No sidebar, no navigation, no notification badges. This is the one mode where
 * the app deliberately stops being an app the student can wander around in: the
 * only way out is to submit, or to leave. The friendly-tutor register recedes
 * here and the layout is the first thing that says so.
 *
 * `calm` is the other half of that: it switches off every entrance and looping
 * animation inside. The rest of the product is deliberately lively; a paper
 * under a running clock is the one place where that would be working against
 * the student rather than for them.
 */
export default async function ExamLayout({ children }: { children: React.ReactNode }) {
  await requireSession();

  return (
    <div className="calm min-h-dvh bg-paper-sunken">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">{children}</div>
    </div>
  );
}
