import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { NewSimulationForm, type SimulationOption } from '@/components/exam/new-simulation-form';
import { PageHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { SHARED_ACROSS_TRACKS } from '@/lib/exam';
import { PUBLISHED_FILTER } from '@/lib/generation';
import { getTranslations } from '@/lib/i18n';
import {
  HAS_LIVE_QUESTIONS,
  OWN_EDITION_ONLY,
  listSubjects,
  paperScopeFor,
  subjectLanguagesFor,
} from '@/lib/queries/taxonomy';
import { LOCALE_LABELS } from '@/lib/i18n/config';

export const metadata: Metadata = { title: 'New simulation' };

/**
 * Composing a paper.
 *
 * The AI-generated option is only offered for subjects that actually have
 * approved problems in the pool. Offering it everywhere and failing on submit
 * would be a worse version of the same constraint — the review gate is not
 * something to discover after choosing.
 */
export default async function NewSimulationPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string; cycle?: string }>;
}) {
  const { subject: fromSubject, cycle: fromCycle } = await searchParams;
  const user = await requireUser();
  const { t } = await getTranslations();

  // One live paper at a time.
  const existing = await db.examSimulation.findFirst({
    where: { userId: user.id, status: 'in_progress' },
    select: { id: true, expiresAt: true },
  });
  if (existing && existing.expiresAt.getTime() > Date.now()) {
    redirect(`/exam-sim/${existing.id}`);
  }

  const subjects = await listSubjects(user.trackId, user.preferredLanguage);

  const subjectIds = subjects.map((subject) => subject.id);

  /*
   * Papers may come from another track that sits the same course from the same
   * book — see `paperScopeFor`. The map carries each one back to the student's
   * own subject, because everything below is keyed by that: the picker groups
   * papers under a subject the student recognises, and a sitting must credit
   * their own subject rather than the track the paper was printed for.
   */
  const paperScope = await paperScopeFor(subjectIds);

  /*
   * FOUR QUERIES, NOT THREE PER SUBJECT.
   *
   * This ran `Promise.all` over the subjects and issued a cycle list, a
   * generated-problem count and a past-exam count inside each one — twenty-one
   * round trips on a seven-subject track, growing with the curriculum, to draw
   * a picker. They are now four reads that do not grow: the cycles, the two
   * counts grouped by chapter, and one chapter-to-subject map to fold those
   * counts up to the subject.
   *
   * The `where` clauses are unchanged. Grouping by chapter rather than by
   * subject is a Prisma constraint — `groupBy` cannot group across a relation
   * — and the map is the cheap way round it.
   */
  const [cycleRows, chapterRows, generatedRows, realRows] = await Promise.all([
    /*
     * Only editions the student can read.
     *
     * The same filter the past-paper list uses, and it matters more here: that
     * page offers a paper to read, this one starts a timed sitting. The
     * humanities have one Arabic subject that a French-track student is shown
     * — `subjectLanguagesFor('fr')` returns ['fr','ar'] — and the CRDP prints
     * those papers in three languages. Without this the picker offers all
     * three editions of "Philosophie LH 2018" under the same title, and a
     * French candidate can start a two-hour Arabic paper by choosing the wrong
     * identical row.
     */
    db.examCycle.findMany({
      where: {
        subjectId: { in: [...paperScope.keys()] },
        // A rejected question is not a question a candidate can sit, so the
        // bare `some: {}` this replaced offered papers with nothing on them.
        ...HAS_LIVE_QUESTIONS,
        language: { in: subjectLanguagesFor(user.preferredLanguage) },
        ...OWN_EDITION_ONLY,
      },
      select: {
        id: true,
        subjectId: true,
        title: true,
        year: true,
        session: true,
        language: true,
        durationMinutes: true,
        durationIsOfficial: true,
        // Only the questions a student can actually be shown: a count that
      // included rejected rows promised a paper fuller than it is.
      _count: { select: { questions: { where: { verifiedStatus: { not: 'rejected' } } } } },
      },
      orderBy: [{ year: 'desc' }, { session: 'asc' }],
    }),

    db.chapter.findMany({
      where: { subjectId: { in: subjectIds } },
      select: { id: true, subjectId: true },
    }),

    db.generatedProblem.groupBy({
      by: ['chapterId'],
      where: { chapter: { subjectId: { in: subjectIds } }, ...PUBLISHED_FILTER },
      _count: { _all: true },
    }),

    /*
     * How many real past-exam questions each subject could assemble a mock
     * paper from. Counted rather than assumed, because the mode is only
     * offered where there is a pool to draw on — and unlike the generated one,
     * most subjects have thousands.
     */
    db.question.groupBy({
      by: ['chapterId'],
      where: {
        chapter: { subjectId: { in: subjectIds } },
        sourceType: 'past_exam',
        verifiedStatus: { not: 'rejected' },
      },
      _count: { _all: true },
    }),
  ]);

  const subjectOfChapter = new Map(chapterRows.map((row) => [row.id, row.subjectId]));

  const foldBySubject = (rows: { chapterId: string; _count: { _all: number } }[]) => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      const subjectId = subjectOfChapter.get(row.chapterId);
      if (!subjectId) continue;
      totals.set(subjectId, (totals.get(subjectId) ?? 0) + row._count._all);
    }
    return totals;
  };

  const generatedBySubject = foldBySubject(generatedRows);
  const realBySubject = foldBySubject(realRows);

  // History, civics and geography draw on every track's papers — see
  // `SHARED_ACROSS_TRACKS`. Counted the same way the pool is queried, so the
  // number shown is the number a paper is actually built from.
  await Promise.all(
    subjects
      .filter((subject) => SHARED_ACROSS_TRACKS.has(subject.name))
      .map(async (subject) => {
        const count = await db.question.count({
          where: {
            alsoInChapters: { some: { chapter: { subjectId: subject.id } } },
            sourceType: 'past_exam',
            verifiedStatus: { not: 'rejected' },
          },
        });
        realBySubject.set(subject.id, count);
      }),
  );

  const cyclesBySubject = new Map<string, typeof cycleRows>();
  for (const cycle of cycleRows) {
    // Filed under the student's own subject, not the one the paper belongs to,
    // so a shared SE physics paper appears under their Physics.
    const under = paperScope.get(cycle.subjectId);
    if (!under) continue;
    const list = cyclesBySubject.get(under);
    if (list) list.push(cycle);
    else cyclesBySubject.set(under, [cycle]);
  }

  const options: SimulationOption[] = subjects.map((subject) => ({
    subjectId: subject.id,
    subjectName: subject.name,
    realPoolCount: realBySubject.get(subject.id) ?? 0,
    cycles: (cyclesBySubject.get(subject.id) ?? []).map((cycle) => ({
      id: cycle.id,
      /*
       * The edition is part of the label, not decoration. A French-track
       * student is offered their own printing and the Arabic one, and the two
       * carry the same title and year — without the language they are two
       * identical rows in a dropdown, and picking the wrong one starts a timed
       * paper in a language the candidate cannot sit.
       */
      label:
        `${cycle.title} · ${cycle.year}` +
        `${cycle.session ? ` · ${cycle.session}` : ''}` +
        ` · ${LOCALE_LABELS[cycle.language]}`,
      questionCount: cycle._count.questions,
      durationMinutes: cycle.durationMinutes,
      durationIsOfficial: cycle.durationIsOfficial,
    })),
    generatedAvailable: generatedBySubject.get(subject.id) ?? 0,
  }));

  return (
    <>
      <PageHeader title={t.examSim.newTitle} description={t.examSim.subtitle} />
      <NewSimulationForm
        options={options}
        initialSubjectId={fromSubject}
        initialCycleId={fromCycle}
      />
    </>
  );
}
