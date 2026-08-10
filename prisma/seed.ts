/**
 * Database seed.
 *
 * Idempotent: safe to run repeatedly. Taxonomy is upserted by natural key, and
 * content is only inserted when the target chapter has none — so re-running the
 * seed after real ingestion will not duplicate or overwrite real content.
 *
 * Embeddings are NOT written here. Seeding must work without an API key, and
 * embedding text costs money. Run `npm run ingest -- --embed-missing` once a
 * provider key is configured to backfill vectors; until then tier-1 and tier-2
 * retrieval simply return nothing and the assistant refuses, which is the
 * correct behaviour for an empty corpus.
 */

import { PrismaClient, type Language } from '@prisma/client';

import { hashPassword } from '../src/lib/auth/password';

import { CONTENT_CHUNKS, EXAM_CYCLES, QUESTIONS, TRACKS } from './seed-data';

const db = new PrismaClient();

const DEMO_ADMIN_EMAIL = 'admin@bac2.local';
const DEMO_STUDENT_EMAIL = 'student@bac2.local';
const DEMO_PASSWORD = 'ChangeMeImmediately!2026';

async function main() {
  console.log('Seeding…');

  // --- Taxonomy ------------------------------------------------------------
  const subjectIdByKey = new Map<string, string>();
  const chapterIdByKey = new Map<string, string>();
  const trackIdByCode = new Map<string, string>();

  for (const track of TRACKS) {
    const trackRow = await db.track.upsert({
      where: { code: track.code },
      update: { name: track.name },
      create: { code: track.code, name: track.name },
    });
    trackIdByCode.set(track.code, trackRow.id);

    for (const subject of track.subjects) {
      // Subjects have no natural unique key in the schema, so match on the
      // (track, name) pair the way a human would.
      const existing = await db.subject.findFirst({
        where: { trackId: trackRow.id, name: subject.name },
        select: { id: true },
      });

      const subjectRow =
        existing ??
        (await db.subject.create({
          data: { trackId: trackRow.id, name: subject.name, language: subject.language as Language },
        }));

      subjectIdByKey.set(`${track.code}::${subject.name}`, subjectRow.id);

      const unitIdByName = new Map<string, string>();
      for (const [index, unitName] of subject.units.entries()) {
        const unit = await db.unit.upsert({
          where: { subjectId_orderIndex: { subjectId: subjectRow.id, orderIndex: index } },
          update: { name: unitName },
          create: { subjectId: subjectRow.id, name: unitName, orderIndex: index },
        });
        unitIdByName.set(unitName, unit.id);
      }

      for (const [index, chapter] of subject.chapters.entries()) {
        const chapterRow = await db.chapter.upsert({
          where: { subjectId_orderIndex: { subjectId: subjectRow.id, orderIndex: index } },
          update: { name: chapter.name, unitId: unitIdByName.get(chapter.unit) ?? null },
          create: {
            subjectId: subjectRow.id,
            unitId: unitIdByName.get(chapter.unit) ?? null,
            name: chapter.name,
            orderIndex: index,
          },
        });
        chapterIdByKey.set(`${track.code}::${subject.name}::${chapter.name}`, chapterRow.id);
      }
    }
  }

  console.log(`  tracks: ${TRACKS.length}, subjects: ${subjectIdByKey.size}, chapters: ${chapterIdByKey.size}`);

  // --- Past papers ---------------------------------------------------------
  const cycleIdByKey = new Map<string, string>();

  for (const cycle of EXAM_CYCLES) {
    const subjectId = subjectIdByKey.get(`${cycle.trackCode}::${cycle.subject}`);
    if (!subjectId) {
      console.warn(`  ! skipping cycle for unknown subject ${cycle.trackCode}/${cycle.subject}`);
      continue;
    }

    const row = await db.examCycle.upsert({
      where: {
        subjectId_year_session: { subjectId, year: cycle.year, session: cycle.session },
      },
      update: { title: cycle.title, durationMinutes: cycle.durationMinutes },
      create: {
        subjectId,
        year: cycle.year,
        session: cycle.session,
        title: cycle.title,
        durationMinutes: cycle.durationMinutes,
      },
    });

    cycleIdByKey.set(`${cycle.trackCode}::${cycle.subject}::${cycle.year}::${cycle.session}`, row.id);
  }

  console.log(`  exam cycles: ${cycleIdByKey.size}`);

  // --- Questions -----------------------------------------------------------
  let questionsCreated = 0;

  for (const question of QUESTIONS) {
    const chapterKey = findChapterKey(chapterIdByKey, question.subject, question.chapter);
    if (!chapterKey) {
      console.warn(`  ! no chapter "${question.chapter}" in "${question.subject}" — skipping question`);
      continue;
    }

    const chapterId = chapterIdByKey.get(chapterKey)!;
    const trackCode = chapterKey.split('::')[0]!;

    // Content-based idempotency: don't re-insert a question we already seeded.
    const already = await db.question.findFirst({
      where: { chapterId, contentText: question.contentText },
      select: { id: true },
    });
    if (already) continue;

    const cycleId = question.cycle
      ? cycleIdByKey.get(
          `${trackCode}::${question.subject}::${question.cycle.year}::${question.cycle.session}`,
        )
      : undefined;

    await db.question.create({
      data: {
        chapterId,
        sourceType: question.cycle ? 'past_exam' : 'textbook',
        sourceExamId: cycleId ?? null,
        questionType: question.questionType,
        difficulty: question.difficulty,
        difficultyConfidence: 0.3, // Author-assigned; the nightly job recalibrates from real attempts.
        contentText: question.contentText,
        contentLatex: question.contentLatex ?? null,
        contentImages: [],
        options: question.options ?? undefined,
        correctOptionId: question.correctOptionId ?? null,
        officialSolution: question.officialSolution ?? null,
        bareme: question.bareme ?? undefined,
        orderIndex: question.cycle?.orderIndex ?? null,
        verifiedStatus: 'verified',
      },
    });
    questionsCreated += 1;
  }

  console.log(`  questions created: ${questionsCreated}`);

  // --- Course material (tier-2 retrieval corpus) ---------------------------
  let chunksCreated = 0;

  for (const chunk of CONTENT_CHUNKS) {
    const chapterKey = findChapterKey(chapterIdByKey, chunk.subject, chunk.chapter);
    if (!chapterKey) {
      console.warn(`  ! no chapter "${chunk.chapter}" in "${chunk.subject}" — skipping chunk`);
      continue;
    }

    const chapterId = chapterIdByKey.get(chapterKey)!;

    const already = await db.contentChunk.findFirst({
      where: { chapterId, title: chunk.title },
      select: { id: true },
    });
    if (already) continue;

    await db.contentChunk.create({
      data: {
        chapterId,
        kind: chunk.kind,
        title: chunk.title,
        contentText: chunk.contentText,
        sourceRef: 'seed:placeholder',
      },
    });
    chunksCreated += 1;
  }

  console.log(`  course material chunks created: ${chunksCreated}`);

  // --- Users ---------------------------------------------------------------
  const sgTrackId = trackIdByCode.get('SG')!;
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await db.user.upsert({
    where: { email: DEMO_ADMIN_EMAIL },
    update: { role: 'admin' },
    create: {
      email: DEMO_ADMIN_EMAIL,
      passwordHash,
      role: 'admin',
      displayName: 'Administrateur',
      trackId: sgTrackId,
      preferredLanguage: 'fr',
      country: 'LB',
      subscription: { create: { plan: 'free', status: 'pending' } },
    },
  });

  const student = await db.user.upsert({
    where: { email: DEMO_STUDENT_EMAIL },
    update: {},
    create: {
      email: DEMO_STUDENT_EMAIL,
      passwordHash,
      role: 'student',
      displayName: 'Élève de démonstration',
      trackId: sgTrackId,
      preferredLanguage: 'fr',
      country: 'LB',
      // A demo account on the free plan with nothing charged — the same state a
      // new signup that skips the payment step lands in.
      subscription: { create: { plan: 'free', status: 'pending' } },
    },
  });

  // The official Bac sitting — the system-default upcoming exam every student
  // starts with, per the exec plan.
  const bacDate = nextMidJune();
  const existingBac = await db.upcomingExam.findFirst({
    where: { userId: student.id, isBacExam: true },
    select: { id: true },
  });
  if (!existingBac) {
    await db.upcomingExam.create({
      data: {
        userId: student.id,
        examDate: bacDate,
        label: 'Baccalauréat',
        isBacExam: true,
      },
    });
  }

  await db.announcement.deleteMany({ where: { title: 'Bienvenue' } });
  await db.announcement.create({
    data: {
      title: 'Bienvenue',
      body:
        'Cette instance contient un contenu de démonstration. Le programme officiel sera chargé ' +
        'par le processus d’ingestion avant la mise en service.',
      targetTrackId: null,
      targetSubjectId: null,
    },
  });

  console.log('');
  console.log('Demo accounts (development only — change these before any deployment):');
  console.log(`  admin   ${DEMO_ADMIN_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  student ${DEMO_STUDENT_EMAIL} / ${DEMO_PASSWORD}`);
  console.log('');
  console.log('Embeddings are not seeded. Run "npm run ingest -- --embed-missing" with an');
  console.log('embedding provider key configured to enable tier-1 and tier-2 retrieval.');
  console.log('Seed complete.');
}

/** Chapter names repeat across subjects, so resolve on the (subject, chapter) pair. */
function findChapterKey(
  chapterIdByKey: Map<string, string>,
  subject: string,
  chapter: string,
): string | null {
  for (const key of chapterIdByKey.keys()) {
    const [, keySubject, keyChapter] = key.split('::');
    if (keySubject === subject && keyChapter === chapter) return key;
  }
  return null;
}

/** The Lebanese Bac sits in mid-June; roll to next year once this year's has passed. */
function nextMidJune(): Date {
  const now = new Date();
  const thisYear = new Date(Date.UTC(now.getUTCFullYear(), 5, 15));
  return thisYear > now ? thisYear : new Date(Date.UTC(now.getUTCFullYear() + 1, 5, 15));
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
