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
  /** Empty means the whole cohort. */
  targetTracks: string[];
  targetSubject: string | null;
  author: string | null;
};

export type TrackOption = { id: string; code: string; label: string };

/**
 * Announcements.
 *
 * Targeting defaults to everyone, and the audience is shown on every row after
 * posting — an announcement about a Maths paper going out to the whole cohort
 * is the kind of mistake that is obvious in hindsight and invisible at the
 * moment of writing.
 *
 * TRACKS ARE CHECKBOXES, NOT A DROPDOWN. A dropdown can say "GS" or "everyone"
 * and has no way to say "GS and LS", which is the announcement an admin
 * actually writes: the two science branches sit most papers on the same day.
 * The old form forced that into two posts, and two posts drift apart the first
 * time one of them is corrected.
 *
 * "All tracks" is the empty selection rather than a fifth box, because the
 * database means it that way and a box that silently clears the other four is
 * a control that argues with itself.
 */
export function AnnouncementManager({
  announcements,
  tracks,
  subjects,
}: {
  announcements: AnnouncementItem[];
  tracks: TrackOption[];
  subjects: { id: string; label: string }[];
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTracks, setSelectedTracks] = useState<string[]>([]);
  const [subjectId, setSubjectId] = useState('');

  function toggleTrack(id: string) {
    setSelectedTracks((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  /*
   * The contradiction the server refuses, caught before the round trip.
   *
   * Picking "GS and LS" plus an LH subject addresses nobody — the dashboard
   * ANDs the two filters. The server returns TARGET_CONFLICT for it either
   * way; showing it here means the admin sees which two choices disagree while
   * both are still on screen in front of them.
   */
  const subjectTrackCode = subjectId
    ? (subjects.find((s) => s.id === subjectId)?.label.split(' · ')[0] ?? null)
    : null;
  const selectedCodes = tracks.filter((tr) => selectedTracks.includes(tr.id)).map((tr) => tr.code);
  const conflict =
    subjectTrackCode !== null &&
    selectedCodes.length > 0 &&
    !selectedCodes.includes(subjectTrackCode);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (conflict) {
      setError(t.admin.targetConflict);
      return;
    }

    setSaving(true);
    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      await sendJson('/api/admin/announcements', 'POST', {
        title: String(data.get('title') ?? ''),
        body: String(data.get('body') ?? ''),
        targetTrackIds: selectedTracks,
        targetSubjectId: subjectId || null,
      });
      form.reset();
      setSelectedTracks([]);
      setSubjectId('');
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
                        {/*
                          One badge per track it went to, or a single neutral
                          badge for the whole cohort. Four badges and "all
                          tracks" mean the same thing to the database and very
                          different things to whoever is auditing what went out.
                        */}
                        {announcement.targetTracks.length === 0 ? (
                          <Badge tone="neutral">{t.admin.allTracks}</Badge>
                        ) : (
                          announcement.targetTracks.map((code) => (
                            <Badge key={code} tone="primary">
                              {code}
                            </Badge>
                          ))
                        )}
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

            {/*
              A fieldset rather than a Field: this is a group of controls with
              one shared question, and a <legend> is what tells a screen reader
              that the four checkboxes below belong to it.
            */}
            <fieldset>
              <legend className="mb-1.5 block text-meta font-medium text-ink">
                {t.admin.targetTracks}
              </legend>

              <div className="flex flex-wrap gap-1.5">
                {tracks.map((track) => {
                  const checked = selectedTracks.includes(track.id);
                  return (
                    <label
                      key={track.id}
                      className={[
                        'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5',
                        'text-meta transition-colors',
                        checked
                          ? 'border-primary bg-primary-soft text-ink'
                          : 'border-rule bg-paper-raised text-ink-muted hover:border-ink-faint',
                      ].join(' ')}
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-primary"
                        checked={checked}
                        onChange={() => toggleTrack(track.id)}
                      />
                      <span className="font-medium">{track.code}</span>
                      <span className="text-ink-faint">{track.label}</span>
                    </label>
                  );
                })}
              </div>

              {/*
                The audience, spelled out under the control. "No boxes ticked"
                reaching every student is correct and not self-evident, and an
                admin about to post to 4,000 people should read that in words
                before they submit rather than infer it from an empty row.
              */}
              <p className="mt-1.5 text-caption text-ink-faint">
                {selectedTracks.length === 0
                  ? t.admin.targetTracksAllHint
                  : t.admin.targetTracksSomeHint.replace('{tracks}', selectedCodes.join(', '))}
              </p>
            </fieldset>

            <Field label={t.admin.targetSubject}>
              {({ id }) => (
                <Select
                  id={id}
                  name="targetSubjectId"
                  value={subjectId}
                  onChange={(event) => setSubjectId(event.target.value)}
                >
                  <option value="">{t.admin.allSubjects}</option>
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {conflict && <Alert tone="warning">{t.admin.targetConflict}</Alert>}
          </SheetBody>

          <SheetFooter className="justify-end">
            <Button type="submit" variant="primary" size="sm" loading={saving} disabled={conflict}>
              {t.common.submit}
            </Button>
          </SheetFooter>
        </form>
      </Sheet>
    </div>
  );
}
