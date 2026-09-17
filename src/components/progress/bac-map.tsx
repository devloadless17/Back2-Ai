import { Meter } from '@/components/ui/progress';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { chapterState } from '@/lib/curriculum';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import type { ChapterSummary } from '@/lib/queries/taxonomy';
import type { SubjectMark } from '@/lib/queries/standing';

/**
 * The Bac Map — the programme, and where the student is in it.
 *
 * Track -> Subject -> Chapter -> Question, which is the hierarchy the schema
 * actually holds. There is no skill or topic level and none is invented here.
 *
 * It is a map of position and evidence, not a visualisation. Subjects are
 * closed by default and open one at a time: a GS track holds 243 chapters,
 * and a page that renders all of them at once is a page nobody scrolls. The
 * question level is the existing chapter page rather than a fourth tier
 * rendered inline — pulling question bodies into `/progress` to display a
 * count would ship the corpus to a phone to draw a number.
 *
 * `<details>` rather than React state on purpose. It works before hydration,
 * it is keyboard-operable and screen-reader-announced without any ARIA, and
 * the browser handles find-in-page inside a closed section.
 */
export async function BacMap({
  subjects,
  chapters,
}: {
  subjects: SubjectMark[];
  chapters: ChapterSummary[];
}) {
  const { t } = await getTranslations();

  if (subjects.length === 0) return null;

  const bySubject = new Map<string, ChapterSummary[]>();
  for (const chapter of chapters) {
    const bucket = bySubject.get(chapter.subjectId);
    if (bucket) bucket.push(chapter);
    else bySubject.set(chapter.subjectId, [chapter]);
  }

  const percent = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <Sheet>
      <SheetHeader title={t.standing.bacMap} description={t.standing.bacMapNote} />
      <SheetBody className="p-0">
        <ul className="ruled">
          {subjects.map((subject) => {
            const own = bySubject.get(subject.subjectId) ?? [];

            return (
              <li key={subject.subjectId}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-paper-sunken">
                    <span className="min-w-0 flex-1 break-words text-sm font-medium text-ink">
                      {subject.subjectName}
                    </span>

                    {/* Only what exists at this level. No badge sorting the
                        subject into strong or weak — nothing in this product
                        knows where strong begins. */}
                    <span className="shrink-0 text-meta text-ink-muted">
                      {subject.evidence.chaptersAttempted === 0
                        ? t.standing.notStarted
                        : `${t.standing.mastery} ${percent(subject.evidence.mastery)}`}
                      {' · '}
                      {format(t.standing.practisedOf, {
                        done: subject.evidence.chaptersAttempted,
                        total: subject.evidence.chaptersTotal,
                      })}
                      {' · '}
                      {format(t.standing.markedAnswers, { count: subject.evidence.attempts })}
                    </span>
                  </summary>

                  {own.length === 0 ? (
                    <p className="px-5 pb-3.5 text-meta text-ink-faint">
                      {t.performance.noDataHint}
                    </p>
                  ) : (
                    <ul className="border-t border-rule bg-paper-sunken/40">
                      {own.map((chapter) => (
                        <ChapterRow
                          key={chapter.id}
                          chapter={chapter}
                          subjectId={subject.subjectId}
                          t={t}
                        />
                      ))}
                    </ul>
                  )}
                </details>
              </li>
            );
          })}
        </ul>
      </SheetBody>
    </Sheet>
  );
}

type Dict = Awaited<ReturnType<typeof getTranslations>>['t'];

/**
 * One chapter, in whichever of the four states it is in.
 *
 * The distinction that matters is the first one: an untouched chapter reads
 * "Not practised", never "0% mastery". Zero mastery is a claim about a
 * student's ability that no evidence supports — it is the same conflation the
 * readiness model was rewritten to stop making, and it would be worse here,
 * printed against a chapter name.
 */
function ChapterRow({
  chapter,
  subjectId,
  t,
}: {
  chapter: ChapterSummary;
  subjectId: string;
  t: Dict;
}) {
  const state = chapterState(chapter);
  const href = `/practice/${subjectId}/${chapter.id}`;

  /*
   * Evidence is reported whenever it exists, independently of the state.
   * A chapter the student worked through whose questions have since been
   * rejected is `readingOnly` — there is nothing left to practise — but their
   * marked answers still happened, and dropping them would quietly erase work
   * the student did.
   *
   * Otherwise: untouched reads "Not practised", never "0% mastery". Zero
   * mastery is a claim about ability that no evidence supports.
   */
  const detail =
    chapter.attemptsCount > 0
      ? `${t.standing.mastery} ${Math.round(chapter.masteryScore * 100)}% · ${format(
          t.standing.markedAnswers,
          { count: chapter.attemptsCount },
        )}`
      : state === 'practisable'
        ? `${t.standing.notPractised} · ${format(t.standing.pastPaperQuestions, {
            count: chapter.questionCount,
          })}`
        : state === 'readingOnly'
          ? `${t.standing.studyMaterial} · ${t.standing.noIndexedQuestions}`
          : t.practice.noQuestions;

  const action =
    state === 'practisable'
      ? t.standing.startPractice
      : state === 'readingOnly'
        ? t.standing.openStudy
        : null;

  const body = (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-2.5">
      <div className="min-w-0 flex-1">
        {/* Chapter names wrap. An Arabic or French chapter title cut in half
            is how two chapters become indistinguishable. */}
        <p
          className={cnState(state)}
        >
          {chapter.name}
        </p>
        <p className="text-caption text-ink-faint">{detail}</p>
      </div>

      {chapter.attemptsCount > 0 && (
        <div className="hidden w-32 shrink-0 sm:block">
          <Meter value={chapter.masteryScore} size="sm" />
        </div>
      )}

      {action && (
        <span className="shrink-0 text-meta font-medium text-primary">{action}</span>
      )}
    </div>
  );

  // An inert chapter has nothing behind it, so it is not a link. Everything
  // else is, including reading-only: the chapter page offers its material and
  // the tutor grounded on it.
  return (
    <li>
      {state === 'inert' ? (
        body
      ) : (
        <a href={href} className="block hover:bg-paper-sunken">
          {body}
        </a>
      )}
    </li>
  );
}

function cnState(state: ReturnType<typeof chapterState>): string {
  return state === 'inert'
    ? 'break-words text-sm text-ink-faint'
    : 'break-words text-sm font-medium text-ink';
}
