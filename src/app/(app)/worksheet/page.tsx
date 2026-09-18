import type { Metadata } from 'next';

import { PrintButton } from '@/components/progress/print-button';
import { QuestionBody } from '@/components/ui/math';
import { BackLink } from '@/components/ui/back-link';
import { requireUser } from '@/lib/auth/guards';
import { getTranslations } from '@/lib/i18n';
import { listChapters, listSubjectsForStudent } from '@/lib/queries/taxonomy';
import { MAX_QUESTIONS, buildWorksheet } from '@/lib/queries/worksheet';
import { dirForLanguage } from '@/lib/i18n/config';

export const metadata: Metadata = { title: 'Worksheet' };

/**
 * A worksheet of real past-exam questions, ready to print.
 *
 * The teacher who trialled this asked for "an app about kinetic and GPE for GS
 * students" and got a good one by accident, out of the tutor. This is the same
 * thing on purpose, and cheaper: nothing is generated, so a sheet costs nothing
 * and is defensible — every question came off a named paper in a named year.
 *
 * A PLAIN FORM, SUBMITTED BY GET. No client state, no JavaScript needed to
 * build a sheet, and the resulting URL is the sheet — so a teacher can bookmark
 * one, mail it to a colleague, or reopen last term's. A React form with local
 * state would lose all three for no gain.
 *
 * THE ANSWER KEY IS A SEPARATE PAGE BREAK, not a separate page. A teacher
 * printing double-sided gets questions and key in one pass; one who wants only
 * the questions stops the printer at page N. Putting the key behind a second
 * request would mean two sheets that can silently disagree once the corpus
 * changes underneath them.
 */
export default async function WorksheetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const { t } = await getTranslations();

  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const subjects = await listSubjectsForStudent(user.trackId, user.preferredLanguage);
  const subjectId = one('subject') ?? '';
  const chapterIds = (one('chapters') ?? '').split(',').filter(Boolean);
  const count = Number(one('count') ?? '8');
  const withSchemeOnly = one('key') === '1';
  const showKey = one('key') === '1';

  const chapters = subjectId ? await listChapters(subjectId, user.id) : [];

  const worksheet = subjectId
    ? await buildWorksheet({
        subjectId,
        chapterIds,
        count: Number.isFinite(count) ? count : 8,
        withSchemeOnly,
        trackId: user.trackId,
      })
    : null;

  /*
   * The sheet is printed and handed to a student, so its direction is the
   * paper's and not the teacher's interface. Resolved once from the subject
   * rather than per question: a maths worksheet set in Arabic carries more
   * Latin symbols than Arabic words, so counting characters question by
   * question would set half the sheet one way and half the other.
   */
  const sheetDir = dirForLanguage(worksheet?.subjectLanguage);

  return (
    <>
      <div className="print:hidden">
        <BackLink href="/dashboard" label={t.nav.dashboard} />

        <h1 className="mb-1 text-xl font-semibold text-ink">{t.worksheet.title}</h1>
        <p className="mb-5 max-w-prose text-caption text-ink-faint">{t.worksheet.subtitle}</p>

        {/* GET, so the URL is the worksheet. See the note above. */}
        <form method="get" className="mb-6 space-y-4 rounded-lg border border-rule p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="text-caption font-medium text-ink">{t.worksheet.subject}</span>
              <select
                name="subject"
                defaultValue={subjectId}
                className="mt-1 w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-caption font-medium text-ink">{t.worksheet.count}</span>
              <input
                type="number"
                name="count"
                min={1}
                max={MAX_QUESTIONS}
                defaultValue={Number.isFinite(count) ? count : 8}
                className="mt-1 w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm"
              />
            </label>

            <label className="flex items-end gap-2 pb-2">
              <input type="checkbox" name="key" value="1" defaultChecked={showKey} />
              <span className="text-caption text-ink">{t.worksheet.withKey}</span>
            </label>
          </div>

          {chapters.length > 0 && (
            <label className="block">
              <span className="text-caption font-medium text-ink">{t.worksheet.chapters}</span>
              <select
                name="chapters"
                defaultValue={chapterIds[0] ?? ''}
                className="mt-1 w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm"
              >
                <option value="">{t.worksheet.allChapters}</option>
                {chapters
                  .filter((c) => c.questionCount > 0)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.questionCount})
                    </option>
                  ))}
              </select>
            </label>
          )}

          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary"
          >
            {t.worksheet.build}
          </button>
        </form>
      </div>

      {worksheet && worksheet.questions.length === 0 && (
        <p className="text-sm text-ink-muted print:hidden">{t.worksheet.none}</p>
      )}

      {worksheet && worksheet.questions.length > 0 && (
        <>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-ink">{worksheet.subjectName}</h2>
              <p className="text-caption text-ink-faint">
                {worksheet.chapterNames.slice(0, 3).join(' · ')}
                {' · '}
                {t.worksheet.ofAvailable
                  .replace('{shown}', String(worksheet.questions.length))
                  .replace('{total}', String(worksheet.available))}
              </p>
            </div>
            <PrintButton label={t.report.print} />
          </div>

          <ol className="space-y-6">
            {worksheet.questions.map((q, i) => (
              <li key={q.id} className="break-inside-avoid border-t border-rule pt-4">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-caption font-semibold text-ink">
                    {i + 1}. {q.chapterName}
                  </span>
                  <span className="text-caption text-ink-faint">
                    {q.year ? `${q.year}` : ''}
                    {q.totalMarks ? ` · ${q.totalMarks} ${t.common.points}` : ''}
                  </span>
                </div>
                <QuestionBody contentText={q.contentText} contentLatex={q.contentLatex} dir={sheetDir} />
              </li>
            ))}
          </ol>

          {showKey && (
            <>
              {/*
                A real page break, so a double-sided print puts the key on its
                own sheet and a teacher can stop the printer before it.
              */}
              <div className="mt-10 border-t-2 border-rule pt-6 print:break-before-page">
                <h2 className="mb-4 text-lg font-semibold text-ink">{t.worksheet.answerKey}</h2>
                <ol className="space-y-5">
                  {worksheet.questions.map((q, i) => (
                    <li key={q.id} className="break-inside-avoid">
                      <p className="text-caption font-semibold text-ink">
                        {i + 1}. {q.chapterName}
                        {q.totalMarks ? ` — ${q.totalMarks} ${t.common.points}` : ''}
                      </p>

                      {q.bareme.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {q.bareme.map((b, k) => (
                            <li key={k} className="text-caption text-ink-muted">
                              • {b.criterion} {b.points ? `(${b.points})` : ''}
                            </li>
                          ))}
                        </ul>
                      )}

                      {q.officialSolution && (
                        <div className="mt-2 text-sm text-ink-muted">
                          <QuestionBody contentText={q.officialSolution} dir={sheetDir} />
                        </div>
                      )}

                      {q.bareme.length === 0 && !q.officialSolution && (
                        <p className="mt-1 text-caption text-ink-faint">{t.worksheet.noKey}</p>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
