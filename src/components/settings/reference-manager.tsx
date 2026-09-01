'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { ApiRequestError, sendForm, sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

/**
 * Personal document library.
 *
 * "Searchable" is shown per document rather than assumed. A document that was
 * stored but not embedded — because the embedding provider was down, or is not
 * configured — is inert for retrieval, and a student who uploaded their whole
 * revision folder deserves to know which of it the assistant can actually see.
 */

export type ReferenceItem = {
  id: string;
  fileName: string | null;
  createdAt: string;
  searchable: boolean;
};

export function ReferenceManager({ references }: { references: ReferenceItem[] }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);

    const form = new FormData();
    form.append('file', file);

    try {
      await sendForm('/api/references', form);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.code === 'NO_TEXT_EXTRACTED'
          ? `${t.upload.readFailed} ${t.upload.readFailedHint}`
          : t.common.unknownError,
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove(id: string) {
    try {
      await sendJson('/api/references', 'DELETE', { id });
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    }
  }

  return (
    <Sheet>
      <SheetHeader
        title={t.settings.references}
        actions={
          <>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,text/plain,image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button
              size="sm"
              variant="primary"
              onClick={() => inputRef.current?.click()}
              loading={uploading}
            >
              {uploading ? t.settings.referenceProcessing : t.settings.uploadReference}
            </Button>
          </>
        }
      />

      <SheetBody className="p-0">
        {error && (
          <div className="px-5 pt-4">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        {references.length === 0 ? (
          <EmptyState
            tone="neutral"
            title={t.settings.referenceEmpty}
            body={t.settings.referenceEmptyHint}
            className="m-4 border-0 bg-transparent"
          />
        ) : (
          <ul className="ruled">
            {references.map((reference) => (
              <li key={reference.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{reference.fileName ?? '—'}</p>
                  <p className="text-caption text-ink-faint">{formatDate(reference.createdAt)}</p>
                </div>

                <Badge tone={reference.searchable ? 'correct' : 'partial'}>
                  {reference.searchable ? t.settings.referenceReady : t.settings.referenceProcessing}
                </Badge>

                <button
                  type="button"
                  onClick={() => remove(reference.id)}
                  className="shrink-0 rounded px-2 py-1 text-caption text-ink-faint transition-colors hover:text-mark"
                >
                  {t.common.delete}
                </button>
              </li>
            ))}
          </ul>
        )}
      </SheetBody>
    </Sheet>
  );
}
