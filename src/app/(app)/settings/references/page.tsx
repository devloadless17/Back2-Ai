import type { Metadata } from 'next';

import { ReferenceManager, type ReferenceItem } from '@/components/settings/reference-manager';
import { Alert } from '@/components/ui/feedback';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { isEmbeddingConfigured } from '@/lib/env';
import { getTranslations } from '@/lib/i18n';

export const metadata: Metadata = { title: 'My documents' };

export default async function ReferencesSettingsPage() {
  const user = await requireUser();
  const { t } = await getTranslations();

  // `embedding IS NOT NULL` decides whether a document is actually searchable,
  // and Prisma cannot express a vector column — so this one goes through raw SQL
  // rather than lying to the student about what their upload is doing.
  const rows = await db.$queryRaw<
    { id: string; file_name: string | null; created_at: Date; searchable: boolean }[]
  >`
    SELECT id, file_name, created_at, (embedding IS NOT NULL) AS searchable
    FROM user_references
    WHERE user_id = ${user.id}::uuid
    ORDER BY created_at DESC
  `;

  const references: ReferenceItem[] = rows.map((row) => ({
    id: row.id,
    fileName: row.file_name,
    createdAt: row.created_at.toISOString(),
    searchable: row.searchable,
  }));

  return (
    <div className="space-y-5">
      <Alert tone="info">{t.settings.referencesSubtitle}</Alert>

      {!isEmbeddingConfigured() && (
        <Alert tone="warning" title={t.chat.aiNotConfigured}>
          {t.chat.aiNotConfiguredHint}
        </Alert>
      )}

      <ReferenceManager references={references} />
    </div>
  );
}
