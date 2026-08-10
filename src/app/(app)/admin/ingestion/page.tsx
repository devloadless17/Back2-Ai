import type { Metadata } from 'next';

import { IngestionConsole, type IngestionJobView } from '@/components/admin/ingestion-console';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';

export const metadata: Metadata = { title: 'Ingestion' };

export default async function AdminIngestionPage() {
  await requireAdmin();

  const [jobs, subjects] = await Promise.all([
    db.ingestionJob.findMany({
      select: {
        id: true,
        kind: true,
        status: true,
        sourceLabel: true,
        itemsTotal: true,
        itemsProcessed: true,
        itemsFailed: true,
        errorMessage: true,
        createdAt: true,
        finishedAt: true,
        subject: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    db.subject.findMany({
      select: { id: true, name: true, track: { select: { code: true } } },
      orderBy: { name: 'asc' },
    }),
  ]);

  const view: IngestionJobView[] = jobs.map((job) => ({
    id: job.id,
    kind: job.kind,
    status: job.status,
    sourceLabel: job.sourceLabel,
    subjectName: job.subject?.name ?? null,
    itemsTotal: job.itemsTotal,
    itemsProcessed: job.itemsProcessed,
    itemsFailed: job.itemsFailed,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  }));

  return (
    <IngestionConsole
      jobs={view}
      subjects={subjects.map((subject) => ({
        id: subject.id,
        label: `${subject.track?.code ?? '—'} · ${subject.name}`,
      }))}
    />
  );
}
