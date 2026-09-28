import { describe, expect, it } from 'vitest';
import { examFiguresSchema, plotPoints, figureContext } from '@/lib/exam-figures';

const base = { id: 'F1', caption: 'Measured response', alt: 'Measured response against time in seconds.',
  xLabel: 'Time (s)', yLabel: 'Response (mV)', xMin: 0, xMax: 4, yMin: 0, yMax: 20,
  nodes: [], edges: [], columns: [], rows: [] };
describe('exam figures', () => {
  it('computes polynomial points from coefficients without evaluating model code', () => {
    const [f] = examFiguresSchema.parse([{ ...base, kind: 'plot', series: [{ label: 'f', coefficients: [1, 2, 1], points: [] }] }]);
    const points = plotPoints(f!, f!.series[0]!);
    expect(points[0]).toEqual({ x: 0, y: 1 });
    expect(points[80]).toEqual({ x: 2, y: 9 });
    expect(points.at(-1)).toEqual({ x: 4, y: 25 });
  });
  it('rejects invalid bounds, out-of-range data and backwards measurements', () => {
    const plot = { ...base, kind: 'plot', series: [{ label: 'a', coefficients: [], points: [{ x: 2, y: 4 }, { x: 1, y: 5 }] }] };
    expect(examFiguresSchema.safeParse([plot]).success).toBe(false);
    expect(examFiguresSchema.safeParse([{ ...plot, xMax: 0 }]).success).toBe(false);
    expect(examFiguresSchema.safeParse([{ ...plot, series: [{ label: 'a', coefficients: [], points: [{ x: 0, y: 0 }, { x: 3, y: 30 }] }] }]).success).toBe(false);
  });
  it('rejects disconnected biology edges and overlapping labels', () => {
    const diagram = { ...base, kind: 'diagram', series: [], nodes: [{ id: 'cell', label: 'Cell', x: 30, y: 50, shape: 'ellipse' }],
      edges: [{ from: 'cell', to: 'missing', label: 'Signal' }] };
    expect(examFiguresSchema.safeParse([diagram]).success).toBe(false);
    expect(examFiguresSchema.safeParse([{ ...diagram, edges: [], nodes: [...diagram.nodes, { ...diagram.nodes[0], id: 'other' }] }]).success).toBe(false);
  });
  it('rejects incomplete tables and duplicate figure IDs', () => {
    const table = { ...base, kind: 'table', series: [], columns: ['Time', 'Response'], rows: [['0', '10'], ['1', '8']] };
    expect(examFiguresSchema.safeParse([table]).success).toBe(true);
    expect(examFiguresSchema.safeParse([{ ...table, rows: [['0']] }]).success).toBe(false);
    expect(examFiguresSchema.safeParse([table, table]).success).toBe(false);
  });
  it('rejects executable markup fields and supplies identical figure data to the marker', () => {
    const figure = { ...base, kind: 'table', series: [], columns: ['Time'], rows: [['1']] };
    expect(examFiguresSchema.safeParse([{ ...figure, svg: '<script>alert(1)</script>' }]).success).toBe(false);
    const figures = examFiguresSchema.parse([figure]);
    expect(figureContext(figures)).toContain(JSON.stringify(figures));
  });
});
