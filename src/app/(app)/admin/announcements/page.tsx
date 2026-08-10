import type { Metadata } from 'next';

import { AnnouncementManager, type AnnouncementItem } from '@/components/admin/announcement-manager';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';

export const metadata: Metadata = { title: 'Announcements' };

export default async function AdminAnnouncementsPage() {
  await requireAdmin();

  const [announcements, tracks, subjects] = await Promise.all([
    db.announcement.findMany({
      select: {
        id: true,
        title: true,
        body: true,
        createdAt: true,
        targetTrack: { select: { code: true } },
        targetSubject: { select: { name: true } },
        author: { select: { displayName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    db.track.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
    db.subject.findMany({
      select: { id: true, name: true, track: { select: { code: true } } },
      orderBy: { name: 'asc' },
    }),
  ]);

  const items: AnnouncementItem[] = announcements.map((announcement) => ({
    id: announcement.id,
    title: announcement.title,
    body: announcement.body,
    createdAt: announcement.createdAt.toISOString(),
    targetTrack: announcement.targetTrack?.code ?? null,
    targetSubject: announcement.targetSubject?.name ?? null,
    author: announcement.author?.displayName ?? announcement.author?.email ?? null,
  }));

  return (
    <AnnouncementManager
      announcements={items}
      tracks={tracks.map((track) => ({ id: track.id, label: `${track.name} (${track.code})` }))}
      subjects={subjects.map((subject) => ({
        id: subject.id,
        label: `${subject.track?.code ?? '—'} · ${subject.name}`,
      }))}
    />
  );
}
