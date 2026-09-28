import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { paperIsComplete } from '@/lib/ai-exam-production';
import { parseExamFigures } from '@/lib/exam-figures';
import { parseBareme } from '@/lib/grading';
import { MathText, QuestionBody } from '@/components/ui/math';
import { ExamFigures } from '@/components/exam/exam-figures';
import { AiPaperDecision } from '@/components/admin/ai-paper-review';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { visualKeysFor } from '@/lib/visual-evidence';

export default async function AiExamsPage() {
  await requireAdmin();
  const { t } = await getTranslations();
  const papers = await db.generatedExamPaper.findMany({
    orderBy: { createdAt: 'desc' }, take: 30,
    include: { problems: { orderBy: { paperOrder: 'asc' } }, subject: { select: { name: true } } },
  });
  const ids = [...new Set(papers.flatMap((p) => p.problems.flatMap((q) => q.styleReferenceIds)))];
  const refs = await db.question.findMany({ where: { id: { in: ids } }, select: {
    id: true, contentText: true, contentLatex: true, contentImages: true, sourcePassage: true, officialSolution: true,
  } });
  const visuals = await visualKeysFor(refs);
  return <div className="space-y-5">
    <PageHeader title={t.examSim.modeAiGenerated} description={t.admin.publishNotice} />
    <Link href="/admin/review-queue" className="text-primary underline">{t.admin.itemType}</Link>
    {papers.length === 0 && <p>{t.admin.queueEmptyHint}</p>}
    {papers.map((paper) => <Sheet key={paper.id}>
      <SheetHeader title={paper.title} description={`${paper.subject.name} · ${paper.durationMinutes} min · ${Number(paper.totalMarks)}/20 · ${paper.status}`} />
      <SheetBody className="space-y-6">
        {paper.problems.map((q, i) => <section key={q.id} className="space-y-3 border-b border-rule pb-5">
          <h2 className="text-lg font-bold">{i + 1}. {t.practice.question}</h2>
          <MathText>{q.contentText}</MathText><ExamFigures figures={parseExamFigures(q.figures)} />
          <details className="rounded border border-rule p-3"><summary>{t.practice.solution} · {t.examSim.baremeBreakdown}</summary>
            <MathText>{q.generatedSolution}</MathText>
            <ul>{parseBareme(q.bareme)?.map((c, j) => <li key={j}><MathText>{`${c.points} — ${c.criterion}`}</MathText></li>)}</ul>
            <p className="text-meta">{q.verificationNotes}</p>
            <pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(q.qualityReport, null, 2)}</pre>
          </details>
          <details className="rounded border border-rule p-3"><summary>{t.examSim.modeRealCycle}</summary>
            {refs.filter((r) => q.styleReferenceIds.includes(r.id)).map((r) => <div key={r.id} className="my-4">
              <QuestionBody contentText={r.contentText} contentLatex={r.contentLatex} images={visuals.get(r.id) ?? []} passage={r.sourcePassage} />
              {r.officialSolution && <MathText>{r.officialSolution}</MathText>}
            </div>)}
          </details>
        </section>)}
        {paper.status === 'review' && <AiPaperDecision id={paper.id} complete={paperIsComplete(paper)} />}
      </SheetBody>
    </Sheet>)}
  </div>;
}
