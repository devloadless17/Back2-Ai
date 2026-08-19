import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge, EmptyState } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Summaries' };

/**
 * The shelf: one book per subject.
 *
 * A student's subjects are a small, fixed set they already picture as books, so
 * they are drawn as books. The point is not decoration — it is that a shelf
 * shows how much of each subject there is at a glance, which a list of names
 * does not. Spine height carries the chapter count.
 *
 * Only the student's own track appears. That is not a filter for tidiness: a
 * summary of another track's syllabus is material they will not be examined on,
 * and revising from it is a waste of the last month before an exam.
 */

/** Spines are tinted per subject so the shelf is scannable, not uniform. */
const SPINES = [
  'from-[#2f4858] to-[#1f2f3a]',
  'from-[#5a3a3a] to-[#3a2424]',
  'from-[#38503a] to-[#233324]',
  'from-[#4a3a5a] to-[#2e2438]',
  'from-[#5a4a2a] to-[#3a301a]',
  'from-[#2a4a52] to-[#1a3036]',
];

export default async function SummariesPage() {
  const user = await requireUser();
  const { t } = await getTranslations();

  const subjects = await db.subject.findMany({
    where: { trackId: user.trackId ?? undefined },
    select: {
      id: true,
      name: true,
      language: true,
      _count: { select: { chapters: true } },
    },
    orderBy: [{ name: 'asc' }],
  });

  /*
   * A chapter with no passages behind it cannot be summarised, and showing it as
   * though it could is the sort of thing that makes a student distrust the
   * whole feature. Counted here so each book shows what is actually readable.
   */
  const readable = await db.$queryRaw<{ subject_id: string; chapters: bigint }[]>`
    SELECT ch.subject_id, count(DISTINCT ch.id) AS chapters
    FROM chapters ch
    JOIN chapter_content_chunks l ON l.chapter_id = ch.id
    GROUP BY ch.subject_id
  `;
  const readableBySubject = new Map(readable.map((r) => [r.subject_id, Number(r.chapters)]));

  const shelf = subjects
    .map((subject) => ({ ...subject, readable: readableBySubject.get(subject.id) ?? 0 }))
    .filter((subject) => subject.readable > 0);

  const tallest = Math.max(...shelf.map((s) => s.readable), 1);

  return (
    <>
      <PageHeader
        title={t.nav.summaries}
        description={t.summaries.subtitle}
      />

      {shelf.length === 0 ? (
        <EmptyState tone="pending" title={t.summaries.empty} body={t.summaries.emptyHint} />
      ) : (
        <div className="rounded-lg border border-rule bg-paper-sunken p-5 sm:p-7">
          <ul className="flex flex-wrap items-end gap-3 sm:gap-4">
            {shelf.map((subject, index) => {
              // 148px to 210px: enough spread to read as different sizes,
              // never so tall that one subject dominates the shelf.
              const height = 148 + Math.round((subject.readable / tallest) * 62);
              return (
                <li key={subject.id}>
                  <Link
                    href={`/summaries/${subject.id}`}
                    className="group block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    style={{ height }}
                  >
                    <span
                      className={`relative flex h-full w-[62px] flex-col justify-between rounded-[3px] bg-gradient-to-b ${
                        SPINES[index % SPINES.length]
                      } px-2 py-3 shadow-sm transition-transform duration-150 group-hover:-translate-y-1.5 sm:w-[70px]`}
                    >
                      {/* The band a hardback has near the top of the spine. */}
                      <span className="absolute inset-x-0 top-6 h-[3px] bg-white/15" aria-hidden />
                      <span className="absolute inset-x-0 bottom-9 h-[3px] bg-white/15" aria-hidden />

                      <span
                        className="mt-9 flex-1 text-[12.5px] font-medium leading-tight text-white/95"
                        style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                      >
                        {subject.name}
                      </span>
                      <span className="text-center text-[11px] font-semibold text-white/70">
                        {subject.readable}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <p className="mt-6 text-[12px] text-ink-faint">{t.summaries.shelfHint}</p>
        </div>
      )}

      {shelf.length > 0 && (
        <ul className="ruled mt-6 rounded-lg border border-rule bg-paper">
          {shelf.map((subject) => (
            <li key={subject.id}>
              <Link
                href={`/summaries/${subject.id}`}
                className="flex items-center justify-between gap-4 px-5 py-3 transition-colors duration-150 hover:bg-paper-sunken"
              >
                <span className="truncate text-sm font-medium text-ink">{subject.name}</span>
                <Badge tone="neutral">{subject.readable}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
