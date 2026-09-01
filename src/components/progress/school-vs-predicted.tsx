import Link from 'next/link';

import { LinkButton } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { IconCheckList, IconShield, IconTrophy } from '@/components/shell/icons';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import type { MarkComparison } from '@/lib/queries/grades';
import { cn } from '@/lib/cn';

/**
 * School marks beside the mark this product predicts.
 *
 * The one place the product checks itself against the outside world. Every
 * other figure here is computed from work done inside it, which means they can
 * all agree with each other and still be wrong about the exam; a school mark
 * comes from a different examiner marking a different paper.
 *
 * So the interesting row is the one that disagrees, and the wording is careful
 * about what a disagreement means. It never says the student is wrong or that
 * the prediction is wrong — it says the two do not match and names which is
 * higher, because that difference points at different actions. A school mark
 * below the prediction usually means exam technique or timing rather than
 * knowledge, which is the opposite of what practice drills fix.
 *
 * The verdict is a word and an icon, never a colour on its own, like every
 * other status in this product.
 */
export async function SchoolVsPredicted({ rows }: { rows: MarkComparison[] }) {
  const { t } = await getTranslations();

  const withSchool = rows.filter((row) => row.school !== null);

  if (withSchool.length === 0) {
    return (
      <Sheet>
        <SheetHeader title={t.performance.schoolTitle} description={t.performance.schoolHint} />
        <SheetBody>
          <EmptyState
            tone="neutral"
            title={t.performance.schoolNone}
            body={t.performance.schoolNoneHint}
            action={
              <LinkButton href="/settings/grades" variant="primary" size="sm">
                {t.nav.grades}
              </LinkButton>
            }
            className="border-0 bg-transparent px-0 py-2"
          />
        </SheetBody>
      </Sheet>
    );
  }

  const VERDICT = {
    aligned: { label: t.performance.verdictAligned, tone: 'correct', Icon: IconShield },
    school_lower: { label: t.performance.verdictSchoolLower, tone: 'mark', Icon: IconCheckList },
    school_higher: { label: t.performance.verdictSchoolHigher, tone: 'partial', Icon: IconTrophy },
  } as const;

  return (
    <Sheet>
      <SheetHeader
        title={t.performance.schoolTitle}
        description={t.performance.schoolHint}
        actions={
          <Link
            href="/settings/grades"
            className="text-meta text-primary underline-offset-2 hover:underline"
          >
            {t.nav.grades}
          </Link>
        }
      />
      <SheetBody className="p-0">
        <div className="scroll-x">
          <table className="w-full text-start">
            <thead>
              <tr className="border-b border-rule">
                <th scope="col" className="label px-5 py-2 text-start">
                  {t.standing.bySubject}
                </th>
                <th scope="col" className="label px-5 py-2 text-end">
                  {t.performance.schoolColumn}
                </th>
                <th scope="col" className="label px-5 py-2 text-end">
                  {t.performance.predictedColumn}
                </th>
                <th scope="col" className="label px-5 py-2 text-end">
                  {t.performance.verdictColumn}
                </th>
              </tr>
            </thead>
            <tbody className="ruled">
              {withSchool.map((row) => {
                const verdict = row.verdict ? VERDICT[row.verdict] : null;
                return (
                  <tr key={row.subjectId}>
                    <td className="px-5 py-3">
                      <p className="text-sm text-ink">{row.subjectName}</p>
                      {/* One test is not a picture. Saying how many marks the
                          average is drawn from is the difference between a
                          figure a student can weigh and one they must take. */}
                      <p className="text-caption text-ink-faint">
                        {format(t.performance.fromMarks, { count: row.schoolCount })}
                      </p>
                    </td>
                    <td className="figure px-5 py-3 text-end text-body">{row.school}</td>
                    <td
                      className={cn(
                        'figure px-5 py-3 text-end text-body',
                        row.predicted === null && 'text-ink-faint',
                      )}
                    >
                      {row.predicted ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-end">
                      {verdict ? (
                        <Badge tone={verdict.tone}>
                          <verdict.Icon width={11} height={11} className="me-1 inline-block" />
                          {verdict.label}
                        </Badge>
                      ) : (
                        <span className="text-caption text-ink-faint">
                          {t.standing.notEnoughYet}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {withSchool.some((row) => row.verdict === 'school_lower') && (
          <p className="border-t border-rule px-5 py-3 text-meta leading-relaxed text-ink-muted">
            {t.performance.schoolLowerAdvice}
          </p>
        )}
      </SheetBody>
    </Sheet>
  );
}
