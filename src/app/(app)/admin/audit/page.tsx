import type { Metadata } from 'next';

import { Badge, EmptyState } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { formatDate } from '@/lib/i18n/format';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t.admin.audit };
}

/**
 * The audit log, read-only.
 *
 * Several rules in this system are only meaningful if they are inspectable:
 * generated content stays admin-gated, a student's locked track was changed by
 * a named person for a stated reason, a paper was auto-submitted rather than
 * abandoned. This is where that is checked. There is no delete control and no
 * API to write one — the table is append-only by design.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  await requireAdmin();
  const { action } = await searchParams;
  const { locale, t } = await getTranslations();

  const [events, actionCounts] = await Promise.all([
    db.auditEvent.findMany({
      where: action ? { action } : undefined,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        ipAddress: true,
        createdAt: true,
        actor: { select: { email: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    db.auditEvent.groupBy({
      by: ['action'],
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
    }),
  ]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
      <Sheet>
        <SheetHeader title={t.admin.audit} description={action ?? undefined} />
        <SheetBody className="p-0">
          {events.length === 0 ? (
            <EmptyState
              tone="neutral"
              title={t.admin.auditEmpty}
              className="m-4 border-0 bg-transparent"
            />
          ) : (
            <ul className="ruled">
              {events.map((event) => (
                <li key={event.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-mono text-[12.5px] font-medium text-ink">{event.action}</p>
                    <p className="text-[11.5px] text-ink-faint">
                      {formatDate(locale, event.createdAt, {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>

                  <p className="mt-0.5 text-[12px] text-ink-muted">
                    {event.actor?.displayName ?? event.actor?.email ?? t.admin.systemFlagged}
                    {event.targetType ? ` → ${event.targetType}` : ''}
                    {event.ipAddress ? ` · ${event.ipAddress}` : ''}
                  </p>

                  {event.metadata !== null && event.metadata !== undefined && (
                    <pre className="scroll-x mt-1 whitespace-pre-wrap rounded bg-paper-sunken px-2 py-1 font-mono text-[11.5px] leading-relaxed text-ink-muted">
                      {JSON.stringify(event.metadata)}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SheetBody>
      </Sheet>

      <Sheet className="h-fit">
        <SheetHeader title={t.common.all} />
        <SheetBody className="p-0">
          <ul className="ruled">
            <li>
              <a
                href="/admin/audit"
                className="flex items-center justify-between gap-2 px-4 py-2 text-[12.5px] transition-colors hover:bg-paper-sunken"
              >
                <span className="text-ink">{t.common.all}</span>
              </a>
            </li>
            {actionCounts.map((row) => (
              <li key={row.action}>
                <a
                  href={`/admin/audit?action=${encodeURIComponent(row.action)}`}
                  className="flex items-center justify-between gap-2 px-4 py-2 transition-colors hover:bg-paper-sunken"
                >
                  <span className="min-w-0 truncate font-mono text-[11.5px] text-ink-muted">
                    {row.action}
                  </span>
                  <Badge tone="neutral">{row._count.action}</Badge>
                </a>
              </li>
            ))}
          </ul>
        </SheetBody>
      </Sheet>
    </div>
  );
}
