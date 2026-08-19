/**
 * Does the material handed to the tutor actually answer the question?
 *
 *   npm run check:ranking
 *
 * `check:refusal` asks whether the pipeline decides to speak. This asks whether
 * what it hands over is worth speaking from. They fail differently: a query can
 * clear every threshold and still be given six passages that mention the topic
 * without explaining it — six exercises saying "prove that (v_n) is geometric"
 * and never the paragraph defining one. The tutor then correctly reports that
 * its material does not define the term, which is honest and useless.
 *
 * Judged on `grounding.context`, the exact text the model receives, rather than
 * on the search results or the shortened source labels. An earlier version of
 * this script measured the labels and reported a third of the true figure.
 *
 * The bar is deliberately low: for "what is X", somewhere in the context there
 * should be X together with wording that explains rather than instructs.
 * Clearing it does not prove the answer is good; failing it proves it cannot be.
 *
 * Every probe states what it expects, because "explained" is not always the
 * right answer. Enzymes are used throughout the grade-12 biology book — ELISA,
 * restriction enzymes — and defined nowhere in it, because they are taught in
 * grade 10. Silence there is correct, and a checker that scored it as a miss
 * was reporting a syllabus boundary as a retrieval defect.
 */

import { PrismaClient } from '@prisma/client';

import { foldArabic } from '../src/lib/ai/embeddings';
import { retrieveGrounding } from '../src/lib/retrieval';

const db = new PrismaClient();

type Expectation = 'explained' | 'refused';

type Probe = {
  track: string;
  query: string;
  /** Written folded for Arabic: أ/إ/آ -> ا, ة -> ه, ى -> ي, no diacritics. */
  term: RegExp;
  expect: Expectation;
  /** Why a refusal is the right answer. Required when it is. */
  because?: string;
};

/*
 * The Arabic probes are lifted from passages the corpus provably holds, not
 * written from memory. A probe list invented by its author tests the author's
 * guess about the syllabus; these each correspond to a paragraph that defines
 * the term, so a miss is the retriever's and not the syllabus's.
 */
const PROBES: Probe[] = [
  { track: 'GS', query: 'What is the photoelectric effect?', term: /photoelectric|photo[ée]lectrique/i, expect: 'explained' },
  { track: 'GS', query: 'What is radioactivity?', term: /radioactiv/i, expect: 'explained' },
  { track: 'GS', query: 'What is an ester?', term: /ester/i, expect: 'explained' },
  { track: 'GS', query: 'What is a conditional probability?', term: /conditional|conditionnelle/i, expect: 'explained' },
  { track: 'GS', query: 'What is a mechanical oscillator?', term: /oscillat/i, expect: 'explained' },
  { track: 'GS', query: "Qu'est-ce qu'un nombre complexe ?", term: /complexe/i, expect: 'explained' },
  { track: 'GS', query: "Qu'est-ce que la cinétique chimique ?", term: /cin[ée]tique/i, expect: 'explained' },
  { track: 'GS', query: "Qu'est-ce qu'une fonction logarithme ?", term: /logarithme/i, expect: 'explained' },
  { track: 'LS', query: 'What is a nerve impulse?', term: /nerve|nerveux|influx/i, expect: 'explained' },
  { track: 'SE', query: "Qu'est-ce qu'une suite géométrique ?", term: /g[ée]om[ée]trique/i, expect: 'explained' },
  { track: 'LH', query: "Qu'est-ce que la conscience en philosophie ?", term: /conscience|وعي/i, expect: 'explained' },

  { track: 'SE', query: 'ما هي البطالة؟', term: /بطاله/, expect: 'explained' },
  { track: 'SE', query: 'ما هو الاستثمار؟', term: /استثمار/, expect: 'explained' },
  { track: 'LH', query: 'ما هو التمييز في النحو؟', term: /تمييز/, expect: 'explained' },

  /*
   * Asked of SE rather than LH on purpose. All four tracks list this chapter,
   * but LH's taxonomy words it "تعريف المقالة: أسعد نصر الله السكاف" where the
   * book's contents page says "أسعد السكاف: تعريف المقالة", and passages are
   * linked to chapters by name — so LH's copy has none. That is a corpus
   * mislink, not a retrieval failure, and probing LH would measure the wrong
   * thing. 29 of 1,162 chapters are unlinked; about three are of this kind.
   */
  { track: 'SE', query: 'ما هو تعريف المقالة؟', term: /مقاله/, expect: 'explained' },

  /*
   * A standing failure, kept rather than removed.
   *
   * The economics book defines it — "يمكن تحديد الإنتاج بأنه عملية تحويل المواد
   * الأولية" — but the best that passage scores against this question is 0.447,
   * just under the 0.45 gate, so the pipeline falls through to the French maths
   * chapter on supply and demand. Nothing here is broken: text-embedding-3-small
   * simply separates Arabic less well than Latin, and the gate cannot be lowered
   * to 0.44 without admitting off-syllabus Arabic that reaches 0.455. Fixing it
   * means a stronger embedding model, which is a spending decision.
   */
  { track: 'SE', query: 'ما هو الإنتاج؟', term: /انتاج/, expect: 'explained' },

  {
    track: 'LS',
    query: 'What is an enzyme?',
    term: /enzyme/i,
    expect: 'refused',
    because: 'used throughout the grade-12 book, defined in the grade-10 one',
  },
];

/**
 * Wording that explains something, in any of the corpus's three languages.
 *
 * The Arabic cues are written folded, and matched against folded context. The
 * books are typeset with full diacritics — يُعرَّف carries a damma and a shadda
 * between its letters — so an unfolded `يعرف` matches almost nothing in them.
 * Every Arabic probe was scoring as unexplained for that reason alone.
 */
const EXPLAINS = new RegExp(
  [
    'on appelle', 'est appelée?', 'est appelé', 'se définit', 'définition', 'on dit que',
    'est dite?\\b', 'on nomme', 'consiste à', 'correspond à',
    'is called', 'is defined', 'we call', 'definition', 'refers to', 'consists of',
    'يسمي', 'تعريف', 'يعرف', 'يمكن تحديد', 'عباره عن', 'يقصد ب', 'المقصود', 'يدعي',
    'نعني ب', 'هي وضع', 'هو اسم', 'هي عمليه', 'هو عمليه', 'هي العلاقه',
    'théorème', 'theorem', 'propriété', 'property', 'نظريه', 'خاصيه',
  ].join('|'),
  'i',
);

/** A window around the term, so "definition" three pages away does not count. */
const WINDOW = 400;

function explainsTheTerm(context: string, term: RegExp): boolean {
  const global = new RegExp(term.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = global.exec(context)) !== null) {
    const from = Math.max(0, match.index - WINDOW);
    if (EXPLAINS.test(context.slice(from, match.index + WINDOW))) return true;
  }
  return false;
}

async function main() {
  let asExpected = 0;
  const failures: string[] = [];

  console.log('  probe                                    tier            chars  verdict         ');
  console.log('  ' + '-'.repeat(94));

  for (const probe of PROBES) {
    const track = await db.track.findUnique({ where: { code: probe.track }, select: { id: true } });
    if (!track) continue;
    const subjects = await db.subject.findMany({ where: { trackId: track.id }, select: { id: true } });

    const grounding = await retrieveGrounding({
      query: probe.query,
      subjectIds: subjects.map((s) => s.id),
      userId: '00000000-0000-0000-0000-000000000000',
    });

    // Folded once, so the Arabic terms and the Arabic cues both match the
    // diacritised text the books are actually written in.
    const context = foldArabic(grounding.context);
    const mentions = probe.term.test(context);
    const explains = mentions && explainsTheTerm(context, probe.term);

    const verdict = explains ? 'explains it' : mentions ? 'mentions only' : 'not in the material';
    const met = probe.expect === 'explained' ? explains : !mentions;
    if (met) asExpected += 1;
    else failures.push(`${probe.query} — wanted ${probe.expect}, got "${verdict}"`);

    console.log(
      `  ${probe.query.slice(0, 38).padEnd(40)}${grounding.tier.padEnd(16)}${String(grounding.context.length).padStart(6)}  ${verdict.padEnd(20)}${met ? 'ok' : 'MISS'}`,
    );
  }

  console.log('');
  console.log(`  behaved as expected:  ${asExpected}/${PROBES.length}`);
  for (const failure of failures) console.log(`    - ${failure}`);
}

main()
  .catch((e) => {
    console.error('Check failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
