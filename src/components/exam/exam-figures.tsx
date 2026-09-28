'use client';

import { useId } from 'react';
import { plotPoints, type ExamFigure } from '@/lib/exam-figures';

const colours = ['#205e8a', '#a13a32', '#477540', '#744e94'];
export function ExamFigures({ figures }: { figures: ExamFigure[] }) {
  const uid = useId().replace(/:/g, '');
  return <div className="space-y-4">{figures.map((f) => {
    const key = `${uid}-${f.id}`;
    const sx = (x: number) => 70 + (x - f.xMin) / (f.xMax - f.xMin) * 480;
    const sy = (y: number) => 330 - (y - f.yMin) / (f.yMax - f.yMin) * 270;
    return <figure key={f.id} className="rounded border border-rule bg-paper-raised p-3" aria-labelledby={`${key}-caption`}>
      <figcaption id={`${key}-caption`} className="mb-2 text-meta font-medium">{f.id} — {f.caption}</figcaption>
      {f.kind === 'table' ? <div className="overflow-x-auto"><table className="w-full border-collapse text-sm">
        <caption className="sr-only">{f.alt}</caption>
        <thead><tr>{f.columns.map((c, i) => <th key={i} scope="col" className="border border-rule p-2 text-start">{c}</th>)}</tr></thead>
        <tbody>{f.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="border border-rule p-2">{v}</td>)}</tr>)}</tbody>
      </table></div> : <svg viewBox="0 0 640 410" role="img" aria-labelledby={`${key}-title ${key}-desc`} className="mx-auto w-full max-w-3xl" direction="ltr">
        <title id={`${key}-title`}>{f.caption}</title><desc id={`${key}-desc`}>{f.alt}</desc>
        {f.kind === 'plot' ? <>
          <defs><clipPath id={`${key}-clip`}><rect x="70" y="60" width="480" height="270" /></clipPath></defs>
          {Array.from({ length: 6 }, (_, i) => {
            const x = f.xMin + (f.xMax - f.xMin) * i / 5;
            const y = f.yMin + (f.yMax - f.yMin) * i / 5;
            return <g key={i} fontSize="12" fill="currentColor">
              <path d={`M ${sx(x)} 60 V 330 M 70 ${sy(y)} H 550`} stroke="currentColor" opacity="0.16" />
              <text x={sx(x)} y="350" textAnchor="middle">{Number(x.toPrecision(4))}</text>
              <text x="62" y={sy(y) + 4} textAnchor="end">{Number(y.toPrecision(4))}</text>
            </g>;
          })}
          <path d="M70 60V330H550" stroke="currentColor" fill="none" />
          <text x="310" y="377" textAnchor="middle" fontSize="14">{f.xLabel}</text>
          <text transform="translate(18 195) rotate(-90)" textAnchor="middle" fontSize="14">{f.yLabel}</text>
          <g clipPath={`url(#${key}-clip)`}>{f.series.map((s, i) => <g key={i}>
            <polyline points={plotPoints(f, s).filter((p) => Number.isFinite(p.y)).map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} fill="none" stroke={colours[i]} strokeWidth="2.5" strokeDasharray={i % 2 ? '7 4' : undefined} />
            {!s.coefficients.length && s.points.map((p, j) => <circle key={j} cx={sx(p.x)} cy={sy(p.y)} r="3" fill={colours[i]} />)}
          </g>)}</g>
          {f.series.map((s, i) => <text key={i} x={75 + (i % 2) * 260} y={22 + Math.floor(i / 2) * 20} fill={colours[i]} fontSize="13">{i + 1}. {s.label}</text>)}
        </> : <>
          <defs><marker id={`${key}-arrow`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="currentColor" /></marker></defs>
          {f.edges.map((e, i) => {
            const a = f.nodes.find((n) => n.id === e.from)!;
            const b = f.nodes.find((n) => n.id === e.to)!;
            const dx = (b.x - a.x) * 6.4, dy = (b.y - a.y) * 4;
            const trim = Math.min(72 / (Math.abs(dx) || 1), 24 / (Math.abs(dy) || 1));
            return <g key={i}><line x1={a.x * 6.4 + dx * trim} y1={a.y * 4 + dy * trim} x2={b.x * 6.4 - dx * trim} y2={b.y * 4 - dy * trim} stroke="currentColor" markerEnd={`url(#${key}-arrow)`} />
              <text x={(a.x + b.x) * 3.2} y={(a.y + b.y) * 2 - 6} textAnchor="middle" fontSize="12">{e.label}</text></g>;
          })}
          {f.nodes.map((n) => <g key={n.id} transform={`translate(${n.x * 6.4} ${n.y * 4})`}>
            {n.shape === 'ellipse' ? <ellipse rx="72" ry="24" fill="white" stroke="currentColor" /> : <rect x="-72" y="-24" width="144" height="48" rx="5" fill="white" stroke="currentColor" />}
            <text textAnchor="middle" dominantBaseline="middle" fontSize="12">{n.label}</text>
          </g>)}
        </>}
      </svg>}
    </figure>;
  })}</div>;
}
