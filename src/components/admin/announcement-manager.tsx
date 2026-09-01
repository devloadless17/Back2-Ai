'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

export type AnnouncementItem = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  targetTrack: string | null;
  targetSubject: string | null;
  author: string | null;
};

/**
 * Announcements.
 *
 * Targeting defaults to everyone, and the audience is shown on every row after
 * posting — an announcement about a Maths paper going out to the whole cohort
 * is the kind of mistake that is obvious in hindsight and invisible at the
 * moment of writing.
 */
export function AnnouncementManager({
  announcements,
  tracks,
  subjects,
}: {
  announcements: AnnouncementItem[];
  tracks: { id: string; label: string }[];
  subjects: { id: string; label: string }[];
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    const form = new FormData(event.currentTarget);

    try {
      await sendJson('/api/admin/announcements', 'POST', {
        title: String(form.get('title') ?? ''),
        body: String(form.get('body') ?? ''),
        targetTrackId: String(form.get('targetTrackId') ?? '') || null,
        targetSubjectId: String(form.get('targetSubjectId') ?? '') || null,
      });
      event.currentTarget.reset();
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await sendJson('/api/admin/announcements', 'DELETE', { id });
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Sheet>
        <SheetHeader title={t.admin.announcements} />
        <SheetBody className="p-0">
          {error && (
            <div className="px-5 pt-4">
              <Alert tone="error">{error}</Alert>
            </div>
          )}

          {announcements.length === 0 ? (
            <EmptyState
              tone="neutral"
              title={t.admin.announcementsEmpty}
              className="m-4 border-0 bg-transparent"
            />
          ) : (
            <ul className="ruled">
              {announcements.map((announcement) => (
                <li key={announcement.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{announcement.title}</p>
                      <p className="mt-0.5 whitespace-pre-wrap text-meta leading-snug text-ink-muted">
                        {announcement.body}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge tone={announcement.targetTrack ? 'primary' : 'neutral'}>
                          {announcement.targetTrack ?? t.admin.allTracks}
                        </Badge>
                        {announcement.targetSubject && (
                          <Badge tone="primary">{announcement.targetSubject}</Badge>
                        )}
                        <span className="text-caption text-ink-faint">
                          {formatDate(announcement.createdAt)}
                          {announcement.author ? ` · ${announcement.author}` : ''}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => remove(announcement.id)}
                      className="shrink-0 rounded px-2 py-1 text-caption text-ink-faint transition-colors hover:text-mark"
                    >
                      {t.common.delete}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SheetBody>
      </Sheet>

      <Sheet className="h-fit">
        <SheetHeader title={t.admin.newAnnouncement} />
        <form onSubmit={create}>
          <SheetBody className="space-y-3">
            <Field label={t.admin.announcementTitle} required>
              {({ id }) => <Input id={id} name="title" maxLength={200} required />}
            </Field>

            <Field label={t.admin.announcementBody} required>
              {({ id }) => <Textarea id={id} name="body" maxLength={5000} required rows={5} />}
            </Field>

            <Field label={t.admin.targetTrack}>
              {({ id }) => (
                <Select id={id} name="targetTrackId">
                  <option value="">{t.admin.allTracks}</option>
                  {tracks.map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label={t.admin.targetSubject}>
              {({ id }) => (
                <Select id={id} name="targetSubjectId">
                  <option value="">{t.admin.allSubjects}</option>
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </SheetBody>

          <SheetFooter className="justify-end">
            <Button type="submit" variant="primary" size="sm" loading={saving}>
              {t.common.submit}
            </Button>
          </SheetFooter>
        </form>
      </Sheet>
    </div>
  );
}
