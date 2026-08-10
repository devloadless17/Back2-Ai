import type { Metadata } from 'next';

import { UserAdmin, type AdminUserRow } from '@/components/admin/user-admin';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t.admin.users };
}

export default async function AdminUsersPage() {
  await requireAdmin();

  const [users, tracks] = await Promise.all([
    db.user.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        preferredLanguage: true,
        isActive: true,
        lastLoginAt: true,
        track: { select: { id: true, code: true } },
        _count: { select: { attempts: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    db.track.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
  ]);

  const rows: AdminUserRow[] = users.map((user) => ({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    preferredLanguage: user.preferredLanguage,
    isActive: user.isActive,
    trackId: user.track?.id ?? null,
    trackCode: user.track?.code ?? null,
    attemptCount: user._count.attempts,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  }));

  return (
    <UserAdmin
      users={rows}
      tracks={tracks.map((track) => ({ id: track.id, label: `${track.name} (${track.code})` }))}
    />
  );
}
