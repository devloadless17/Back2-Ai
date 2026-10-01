import Link from 'next/link';

import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import type { SubjectMark } from '@/lib/queries/standing';

/**
 * The programme at subject level.
 *
 * The previous version embedded every chapter in the track inside closed
 * `<details>` elements. A GS response carried roughly two hundred chapter rows
 * even though the screen explicitly asks the student to open one subject to
 * see its chapters. The subject hub already is that chapter map, with richer
 * question and reading availability, so this page links to it instead of
 * duplicating it in a 400 KB response.
 */
export async function BacMap({ subjects }: { subjects: SubjectMark[] }) {
  const { t } = await getTranslations();
  if (subjects.length === 0) return null;

  const percent = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <Sheet>
      <SheetHeader title={t.standing.bacMap} description={t.standing.bacMapNote} />
      <SheetBody className="p-0">
        <ul className="ruled">
          {subjects.map((subject) => (
            <li key={subject.subjectId}>
              <Link
                href={`/practice/${subject.subjectId}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-paper-sunken"
              >
                <span className="min-w-0 flex-1 break-words text-sm font-medium text-ink">
                  {subject.subjectName}
                </span>
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
                <span aria-hidden="true" className="text-ink-faint">›</span>
              </Link>
            </li>
          ))}
        </ul>
      </SheetBody>
    </Sheet>
  );
}
