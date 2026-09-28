import { z } from 'zod';

export const aiExamBlueprintSchema = z.object({
  title: z.string().min(5).max(180), subjectId: z.string().uuid(),
  /** Practice duration is explicit, never presented as an official paper's. */
  basis: z.enum(['practice', 'official']), sourceExamId: z.string().uuid().nullable(),
  durationMinutes: z.number().int().min(15).max(360), totalMarks: z.literal(20),
  exercises: z.array(z.object({
    chapterId: z.string().uuid(), referenceIds: z.array(z.string().uuid()).min(1).max(3),
    marks: z.number().min(2).max(10).refine((n) => Number.isInteger(n * 2)),
    difficulty: z.number().min(0).max(1),
    objective: z.string().min(10).max(1000),
    requiredFigure: z.enum(['none', 'plot', 'diagram', 'table']),
  }).strict()).min(3).max(8),
}).strict().superRefine((b, ctx) => {
  if (Math.abs(b.exercises.reduce((sum, e) => sum + e.marks, 0) - b.totalMarks) > 0.001) {
    ctx.addIssue({ code: 'custom', message: 'Exercise marks must total exactly 20.' });
  }
  if (new Set(b.exercises.map((e) => e.chapterId)).size < 3) ctx.addIssue({ code: 'custom', message: 'A paper needs at least three chapters.' });
  if (b.basis === 'official' && !b.sourceExamId) ctx.addIssue({ code: 'custom', message: 'An official blueprint needs its source paper.' });
});
export type AiExamBlueprint = z.infer<typeof aiExamBlueprintSchema>;
