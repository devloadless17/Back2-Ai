import type { Metadata } from 'next';
import Link from 'next/link';

import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { requireAdmin } from '@/lib/auth/guards';
import { inspectContent } from '@/lib/content-monitor';
import { db } from '@/lib/db';

export const metadata: Metadata = { title: 'Content monitor' };

export default async function ContentMonitorPage() {
  await requireAdmin();
  const subjects = await db.subject.findMany({
    select: {
      id: true,
      name: true,
      language: true,
      track: { select: { code: true } },
      chapters: {
        select: {
          id: true,
          name: true,
          cancelledAt: true,
          contentChunks: { select: { chunk: { select: { id: true, contentText: true } } } },
          questions: {
            where: { verifiedStatus: { not: 'rejected' } },
            select: {
              id: true,
              contentText: true,
              contentLatex: true,
              sourcePassage: true,
              officialSolution: true,
              modelSolution: true,
              bareme: true,
              verifiedStatus: true,
            },
          },
        },
      },
    },
    orderBy: [{ track: { code: 'asc' } }, { name: 'asc' }],
  });
  const issues = inspectContent(subjects);
  const critical = issues.filter((issue) => issue.severity === 'critical').length;
  const warnings = issues.length - critical;

  return (
    <Sheet>
      <SheetHeader
        title="Content monitor"
        description="Live, deterministic checks of the material students can see. No AI calls."
      />
      <SheetBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Critical" value={critical} tone="text-mark" />
          <Metric label="Warnings" value={warnings} tone="text-partial" />
          <Metric label="Checks reported" value={issues.length} tone="text-ink" />
        </div>
        <div className="overflow-x-auto rounded border border-rule">
          <table className="w-full text-left text-sm">
            <thead className="bg-paper-sunken text-ink-muted">
              <tr><th className="p-3">Level</th><th className="p-3">Course</th><th className="p-3">Chapter</th><th className="p-3">Problem</th></tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={`${issue.code}:${issue.itemId}`} className="border-t border-rule align-top">
                  <td className={`p-3 font-medium ${issue.severity === 'critical' ? 'text-mark' : 'text-partial'}`}>{issue.severity}</td>
                  <td className="p-3 whitespace-nowrap">{issue.track} · {issue.subject}</td>
                  <td className="p-3">
                    <Link className="text-primary underline-offset-2 hover:underline" href={`/practice/${issue.subjectId}/${issue.chapterId}`}>
                      {issue.chapter}
                    </Link>
                  </td>
                  <td className="p-3"><span className="font-medium">{issue.code.replaceAll('_', ' ')}</span><br/><span className="text-ink-muted">{issue.detail}</span>{issue.code === 'missing_passage' || issue.code === 'invalid_french_exercise' ? <><br/><span className="text-xs font-medium text-correct">Automatically withheld from practice, quizzes, flashcards and mock exams.</span></> : null}</td>
                </tr>
              ))}
              {issues.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-ink-muted">No content problems detected.</td></tr>}
            </tbody>
          </table>
        </div>
      </SheetBody>
    </Sheet>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className="rounded border border-rule bg-paper-sunken p-4"><p className="text-meta text-ink-muted">{label}</p><p className={`text-2xl font-bold ${tone}`}>{value}</p></div>;
}
