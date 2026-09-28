import 'server-only';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ai, embed } from '@/lib/ai';
import type { AiImage } from '@/lib/ai/types';
import { db } from '@/lib/db';
import { aiExamBlueprintSchema, type AiExamBlueprint } from '@/lib/ai-exam-blueprint';
import { examFiguresSchema, FIGURES_JSON_SCHEMA, FIGURE_INSTRUCTIONS } from '@/lib/exam-figures';
import { checkExerciseStructure, hasCurrentQuality, partSchema, QUALITY_VERSION, reviewGeneratedExercise } from '@/lib/generated-exam-quality';
import { parseBareme, baremeMaxScore } from '@/lib/grading';
import { selectVisualsFor } from '@/lib/visual-evidence';
import { getObject } from '@/lib/storage';
import { findNearDuplicate, setEmbedding } from '@/lib/vector';

const criterion = z.object({ partId: z.string(), criterion: z.string().min(5), points: z.number().positive() });
const outputSchema = z.object({
  content_text: z.string().min(100).max(20000), solution: z.string().min(40).max(30000),
  final_answer: z.string().min(1).max(5000), figures: examFiguresSchema,
  parts: z.array(partSchema).min(2).max(16), bareme: z.array(criterion).min(2).max(40),
}).strict();
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const str = { type: 'string' }, num = { type: 'number' };
const OUTPUT_JSON_SCHEMA = obj({
  content_text: str, solution: str, final_answer: str, figures: FIGURES_JSON_SCHEMA,
  parts: { type: 'array', items: obj({ id: str, answer: str, marks: num, figureIds: { type: 'array', items: str } }) },
  bareme: { type: 'array', items: obj({ partId: str, criterion: str, points: num }) },
});

export async function validateBlueprint(raw: unknown): Promise<AiExamBlueprint> {
  const b = aiExamBlueprintSchema.parse(raw);
  const chapters = await db.chapter.findMany({ where: { id: { in: b.exercises.map((e) => e.chapterId) }, subjectId: b.subjectId }, select: { id: true } });
  if (b.exercises.some((e) => !chapters.some((c) => c.id === e.chapterId))) throw new Error('A blueprint chapter belongs to another subject or does not exist.');
  if (b.basis === 'official') {
    const paper = await db.examCycle.findFirst({ where: { id: b.sourceExamId!, subjectId: b.subjectId }, include: { questions: { select: { id: true, chapterId: true, bareme: true, contentText: true } } } });
    if (!paper?.durationIsOfficial || paper.durationMinutes !== b.durationMinutes) throw new Error('Official duration has not been verified for this source paper.');
    // Optional-choice papers require a separately reviewed practice plan, not a guessed denominator.
    const refs = b.exercises.flatMap((e) => e.referenceIds);
    if (paper.questions.length !== b.exercises.length || refs.length !== paper.questions.length || new Set(refs).size !== refs.length || paper.questions.some((q) => !refs.includes(q.id))) throw new Error('Official blueprint must cover each source exercise exactly once. Use practice basis for a selected subset.');
    for (const e of b.exercises) {
      const q = paper.questions.find((q) => q.id === e.referenceIds[0]);
      const rubric = parseBareme(q?.bareme);
      if (!rubric || Math.abs(baremeMaxScore(rubric) - e.marks) > 0.001 || q?.chapterId !== e.chapterId) throw new Error('Official exercise marks/chapters do not match the source.');
    }
  }
  return b;
}

async function produceExercise(b: AiExamBlueprint, order: number, paperId: string) {
  const plan = b.exercises[order]!;
  const refs = await db.question.findMany({
    where: { id: { in: plan.referenceIds }, chapterId: plan.chapterId, sourceType: 'past_exam', verifiedStatus: { not: 'rejected' } },
    select: { id: true, contentText: true, contentLatex: true, contentImages: true, sourcePassage: true, officialSolution: true, bareme: true },
  });
  if (refs.length !== plan.referenceIds.length || refs.some((r) => !parseBareme(r.bareme))) throw new Error('Every reference must be a real exam question in the planned chapter with a readable marking scheme.');
  const subject = await db.subject.findUniqueOrThrow({ where: { id: b.subjectId }, select: { name: true, language: true } });
  const material = await db.contentChunk.findMany({ where: { chapters: { some: { chapterId: plan.chapterId } } }, select: { contentText: true }, take: 5 });
  const selections = await selectVisualsFor(refs);
  const images: AiImage[] = [];
  const referenceText: string[] = [];
  for (const ref of refs) {
    const selection = selections.get(ref.id);
    if (selection?.unresolvedConsumers.length || selection?.incompleteGroups.length) throw new Error(`Reference ${ref.id} has incomplete visual evidence.`);
    const first = images.length + 1;
    for (const key of selection?.keys ?? []) {
      if (images.length >= 8) throw new Error('Too many reference images; select fewer references.');
      const bytes = await getObject(key);
      const sharp = (await import('sharp')).default;
      const image = await sharp(bytes).resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      images.push({ mediaType: 'image/png', base64: image.toString('base64') });
    }
    referenceText.push(JSON.stringify({ reference: ref.id, question: ref.contentLatex ?? ref.contentText, passage: ref.sourcePassage,
      solution: ref.officialSolution, markingScheme: ref.bareme,
      attachedImages: images.length >= first ? `Images ${first} through ${images.length}` : 'None; do not imitate any absent visual.' }));
  }
  const referenceContext = referenceText.join('\n') + '\nCourse material:\n' + material.map((m) => m.contentText).join('\n').slice(0, 20000);
  let feedback = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await ai().completeJson({
      system: `Write an original, self-contained Lebanese Baccalaureate exercise in ${subject.language} for ${subject.name}. Match the supplied references' level and syllabus, not their wording. Change the mathematical scenario, not just numbers. Follow the specified objective and marks. Never copy unsupported medical claims. Number each part on its own line with IDs 1, 2a, 2b etc; include each ID in parts and marking criteria. Supply a worked answer for EVERY part. Use half/whole marks with method credit; one criterion per independently creditable step. Do not put answers or solution-only figures in the question. Use Markdown and LaTeX. ${FIGURE_INSTRUCTIONS}`,
      messages: [{ role: 'user', content: JSON.stringify({ plan, references: referenceContext, previousRejection: feedback }) }],
      images, schema: OUTPUT_JSON_SCHEMA, schemaName: 'exam_exercise_v2', effort: 'high', maxTokens: 16000,
      parse: (v) => outputSchema.parse(v),
    });
    const q = outputSchema.parse(response.data);
    const issues = checkExerciseStructure({ text: q.content_text, figures: q.figures, parts: q.parts, bareme: q.bareme, targetMarks: plan.marks, requiredFigure: plan.requiredFigure });
    if (issues.length) { feedback = issues.join(' '); continue; }
    const content = { contentText: q.content_text, contentLatex: null, generatedSolution: q.solution,
      finalAnswer: q.final_answer, figures: q.figures,
      bareme: q.bareme.map((c) => ({ criterion: `${c.partId}. ${c.criterion}`, points: c.points })) };
    const quality = await reviewGeneratedExercise({ content, parts: q.parts, referenceText: referenceContext, targetMarks: plan.marks });
    if (!quality.passed) { feedback = quality.issues.join(' '); continue; }
    const embedding = await embed(content.contentText, 'document');
    if (await findNearDuplicate(embedding, plan.chapterId, 0.95)) { feedback = 'Too similar to an existing exercise. Change scenario and approach.'; continue; }
    const result = await db.generatedProblem.create({ data: {
      ...content, figures: content.figures as unknown as Prisma.InputJsonValue,
      chapterId: plan.chapterId, styleReferenceIds: plan.referenceIds, difficulty: plan.difficulty,
      generatedPaperId: paperId, paperOrder: order, promptVersion: QUALITY_VERSION,
      modelUsed: response.modelUsed, verificationStatus: 'solver_passed', verificationNotes: 'Every part independently solved and reviewed; awaiting human paper review.',
      qualityReport: { ...quality, parts: q.parts } as unknown as Prisma.InputJsonValue,
    } });
    await setEmbedding('generated_problems', result.id, embedding);
    return result;
  }
  throw new Error(`Exercise ${order + 1} did not pass quality checks: ${feedback}`);
}

/** Serial, resumable production. Failed papers remain unavailable to students. */
export async function produceAiExam(raw: unknown, resumeId?: string) {
  const blueprint = await validateBlueprint(raw);
  const paper = resumeId
    ? await db.generatedExamPaper.findUniqueOrThrow({ where: { id: resumeId } })
    : await db.generatedExamPaper.create({ data: { subjectId: blueprint.subjectId, title: blueprint.title,
      blueprint: blueprint as unknown as Prisma.InputJsonValue, durationMinutes: blueprint.durationMinutes, totalMarks: blueprint.totalMarks } });
  if (paper.status !== 'draft' || JSON.stringify(aiExamBlueprintSchema.parse(paper.blueprint)) !== JSON.stringify(blueprint)) throw new Error('Only a matching draft paper can be resumed.');
  for (let i = 0; i < blueprint.exercises.length; i++) {
    const existing = await db.generatedProblem.findFirst({ where: { generatedPaperId: paper.id, paperOrder: i } });
    if (existing) {
      if (!hasCurrentQuality(existing)) throw new Error('A previously generated exercise was modified; create a new paper.');
      continue;
    }
    console.info(`[ai-exam] Paper ${paper.id}, exercise ${i + 1}/${blueprint.exercises.length}`);
    await produceExercise(blueprint, i, paper.id);
  }
  await db.generatedExamPaper.update({ where: { id: paper.id }, data: { status: 'review' } });
  return paper.id;
}

export function paperIsComplete(paper: { blueprint: unknown; subjectId: string; durationMinutes: number; totalMarks: unknown; problems: (Parameters<typeof hasCurrentQuality>[0] & { chapterId: string; paperOrder: number | null })[] }): boolean {
  const parsed = aiExamBlueprintSchema.safeParse(paper.blueprint);
  if (!parsed.success) return false;
  const b = parsed.data;
  if (b.subjectId !== paper.subjectId || b.durationMinutes !== paper.durationMinutes || Number(paper.totalMarks) !== b.totalMarks || paper.problems.length !== b.exercises.length) return false;
  return b.exercises.every((e, i) => {
    const q = paper.problems.find((q) => q.paperOrder === i);
    const bareme = parseBareme(q?.bareme);
    return q && q.chapterId === e.chapterId && hasCurrentQuality(q) && bareme && Math.abs(baremeMaxScore(bareme) - e.marks) < 0.001;
  });
}
