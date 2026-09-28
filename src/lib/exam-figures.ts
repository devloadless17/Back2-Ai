import { z } from 'zod';

const label = z.string().max(180);
const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const series = z.object({
  label: label.min(1), points: z.array(point).max(200),
  /** Ascending powers; sampled by our renderer, never evaluated as code. */
  coefficients: z.array(z.number().finite().min(-1e6).max(1e6)).max(7),
}).strict();
const node = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,30}$/), label: label.min(1),
  x: z.number().min(12).max(88), y: z.number().min(10).max(90),
  shape: z.enum(['box', 'ellipse']),
}).strict();
const edge = z.object({ from: z.string(), to: z.string(), label }).strict();

export const examFigureSchema = z.object({
  id: z.string().regex(/^F[1-9][0-9]?$/),
  kind: z.enum(['plot', 'diagram', 'table']),
  caption: label.min(1), alt: z.string().min(10).max(600),
  xLabel: label, yLabel: label,
  xMin: z.number().finite(), xMax: z.number().finite(),
  yMin: z.number().finite(), yMax: z.number().finite(),
  series: z.array(series).max(4), nodes: z.array(node).max(16),
  edges: z.array(edge).max(24), columns: z.array(label.min(1)).max(8),
  rows: z.array(z.array(z.string().max(160)).max(8)).max(30),
}).strict().superRefine((f, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (f.kind === 'plot') {
    if (!(f.xMax > f.xMin && f.yMax > f.yMin) || !f.xLabel || !f.yLabel || !f.series.length) {
      issue('Plots need increasing finite axis bounds, labelled axes and at least one series.');
    }
    for (const s of f.series) {
      if ((s.coefficients.length > 0) === (s.points.length > 0)) issue('Use either polynomial coefficients or measured points.');
      if (!s.coefficients.length && s.points.length < 2) issue('A measured series needs at least two points.');
      if (s.points.some((p, i) => p.x < f.xMin || p.x > f.xMax || p.y < f.yMin || p.y > f.yMax || (i > 0 && p.x <= s.points[i - 1]!.x))) {
        issue('Measured points must be ordered, distinct in x, and inside the axes.');
      }
    }
    if (f.nodes.length || f.edges.length || f.columns.length || f.rows.length) issue('Plot contains unrelated diagram/table fields.');
  } else if (f.kind === 'diagram') {
    const ids = new Set(f.nodes.map((n) => n.id));
    if (!ids.size || ids.size !== f.nodes.length) issue('Diagram nodes must have unique IDs.');
    if (f.edges.some((e) => !ids.has(e.from) || !ids.has(e.to) || e.from === e.to)) issue('Diagram edge references an absent node.');
    for (let i = 0; i < f.nodes.length; i++) for (let j = i + 1; j < f.nodes.length; j++) {
      if (Math.abs(f.nodes[i]!.x - f.nodes[j]!.x) < 24 && Math.abs(f.nodes[i]!.y - f.nodes[j]!.y) < 14) issue('Diagram labels overlap; separate the nodes.');
    }
    if (f.series.length || f.columns.length || f.rows.length) issue('Diagram contains unrelated plot/table fields.');
  } else {
    if (!f.columns.length || !f.rows.length || f.rows.some((r) => r.length !== f.columns.length)) issue('Every table row must match the column headers.');
    if (f.series.length || f.nodes.length || f.edges.length) issue('Table contains unrelated plot/diagram fields.');
  }
});

export const examFiguresSchema = z.array(examFigureSchema).max(6).superRefine((figures, ctx) => {
  if (new Set(figures.map((f) => f.id)).size !== figures.length) ctx.addIssue({ code: 'custom', message: 'Figure IDs must be unique.' });
});
export type ExamFigure = z.infer<typeof examFigureSchema>;

export function parseExamFigures(value: unknown): ExamFigure[] {
  return examFiguresSchema.parse(value ?? []);
}

export function plotPoints(f: ExamFigure, s: ExamFigure['series'][number]) {
  if (!s.coefficients.length) return s.points;
  return Array.from({ length: 161 }, (_, i) => {
    const x = f.xMin + (f.xMax - f.xMin) * i / 160;
    const y = s.coefficients.reduceRight((sum, coefficient) => sum * x + coefficient, 0);
    return { x, y };
  });
}

/** The marker and solver see exactly the data used to render the student's figures. */
export function figureContext(figures: ExamFigure[]): string {
  return figures.length ? `\n\n# Supplied figures (rendered from this data)\n${JSON.stringify(figures)}` : '';
}

const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const str = { type: 'string' };
const num = { type: 'number' };
const arr = (items: unknown) => ({ type: 'array', items });
export const FIGURES_JSON_SCHEMA = arr(obj({
  id: str, kind: { type: 'string', enum: ['plot', 'diagram', 'table'] }, caption: str, alt: str,
  xLabel: str, yLabel: str, xMin: num, xMax: num, yMin: num, yMax: num,
  series: arr(obj({ label: str, points: arr(obj({ x: num, y: num })), coefficients: arr(num) })),
  nodes: arr(obj({ id: str, label: str, x: num, y: num, shape: { type: 'string', enum: ['box', 'ellipse'] } })),
  edges: arr(obj({ from: str, to: str, label: str })), columns: arr(str), rows: arr(arr(str)),
}));

export const FIGURE_INSTRUCTIONS = `Figures must be structured data, never URLs, HTML, SVG, or imaginary attachments.
Use kind plot for coordinate graphs or measured biology data; label axes with units.
For polynomial plots supply coefficients in ascending powers and empty points; the renderer computes the curve.
For measured data supply ordered (x,y) points and empty coefficients. Axis bounds must contain measured points.
Use kind diagram for labelled biological/process schematics: box/ellipse nodes at x/y percentages, with edges.
Nodes must be separated by at least 24 horizontally or 14 vertically. Keep labels short and never include answers.
Use kind table for experimental data, with columns and equally sized rows.
All fields are required: use empty arrays/strings and zero axis bounds for inapplicable fields.
Give each figure a unique ID F1, F2, etc. Refer to its ID in the statement. Captions and alt text describe givens only.
Do not supply a completed graph if the student is asked to draw it; supply a data table instead.
If a precise anatomical image or unsupported visual is essential, do not pretend a flowchart replaces it; choose another self-contained exercise.`;
