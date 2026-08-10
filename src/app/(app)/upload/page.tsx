import type { Metadata } from 'next';

import { UploadPanel } from '@/components/chat/upload-panel';
import { Alert } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { isAiConfigured, isEmbeddingConfigured } from '@/lib/env';
import { getTranslations } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Upload a photo' };

export default async function UploadPage() {
  await requireUser();
  const { t } = await getTranslations();

  const configured = isAiConfigured() && isEmbeddingConfigured();

  return (
    <>
      <PageHeader title={t.upload.title} description={t.upload.subtitle} />

      {!configured ? (
        <Alert tone="warning" title={t.chat.aiNotConfigured}>
          {t.chat.aiNotConfiguredHint}
        </Alert>
      ) : (
        <UploadPanel />
      )}
    </>
  );
}
