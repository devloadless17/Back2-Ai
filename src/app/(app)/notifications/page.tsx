import type { Metadata } from 'next';
import Link from 'next/link';

import { MarkAllReadButton } from '@/components/notifications/mark-all-read';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { PageHeader, Sheet, SheetBody } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { cn } from '@/lib/cn';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { formatDate } from '@/lib/i18n/format';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const user = await requireUser();
  const { locale, t } = await getTranslations();

  const notifications = await db.notification.findMany({
    where: { userId: user.id },
    orderBy: [{ isRead: 'asc' }, { createdAt: 'desc' }],
    take: 50,
  });

  const unread = notifications.filter((n) => !n.isRead).length;

  return (
    <>
      <PageHeader
        title={t.notifications.title}
        actions={unread > 0 ? <MarkAllReadButton /> : null}
      />

      {notifications.length === 0 ? (
        <EmptyState tone="positive" title={t.notifications.empty} body={t.notifications.emptyHint} />
      ) : (
        <Sheet>
          <SheetBody className="p-0">
            <ul className="ruled">
              {notifications.map((notification) => {
                const body = (
                  <div className="flex items-start gap-3 px-5 py-3.5">
                    <span
                      className={cn(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        notification.isRead ? 'bg-transparent' : 'bg-primary',
                      )}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-sm', notification.isRead ? 'text-ink-muted' : 'text-ink')}>
                        {notification.message}
                      </p>
                      <p className="mt-0.5 text-caption text-ink-faint">
                        {formatDate(locale, notification.createdAt)}
                      </p>
                    </div>
                    <Badge tone={notification.type === 'announcement' ? 'primary' : 'neutral'}>
                      {notification.type === 'flashcards_due'
                        ? t.nav.flashcards
                        : notification.type === 'schedule_reminder'
                          ? t.nav.schedule
                          : t.dashboard.announcements}
                    </Badge>
                  </div>
                );

                return (
                  <li key={notification.id}>
                    {notification.href ? (
                      <Link href={notification.href} className="block transition-colors hover:bg-paper-sunken">
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          </SheetBody>
        </Sheet>
      )}
    </>
  );
}
