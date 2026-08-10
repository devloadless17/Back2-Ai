'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { Meter } from '@/components/ui/progress';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { sendForm, sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

export type IngestionJobView = {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  sourceLabel: string | null;
  subjectName: string | null;
  itemsTotal: number;
  itemsProcessed: number;
  itemsFailed: number;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
};

/**
 * Ingestion console.
 *
 * Running jobs are polled, because segmenting a scanned paper takes minutes and
 * a static page gives an administrator no way to tell a slow job from a dead
 * one. Polling stops when nothing is running — there is no reason to keep
 * hitting the database on an idle screen.
 */
const POLL_INTERVAL_MS = 4000;

export function IngestionConsole({
  jobs,
  subjects,
}: {
  jobs: IngestionJobView[];
  subjects: { id: string; label: string }[];
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = jobs.some((job) => job.status === 'running' || job.status === 'queued');

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, router]);

  async function ingest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const form = new FormData(event.currentTarget);

    try {
      await sendForm('/api/admin/ingestion', form);
      formRef.current?.reset();
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    } finally {
      setBusy(false);
    }
  }

  async function backfillEmbeddings() {
    setBusy(true);
    setError(null);
    try {
      await sendJson('/api/admin/ingestion', 'POST', { kind: 'embed_missing' });
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    } finally {
      setBusy(false);
    }
  }

  async function recalibrate() {
    setBusy(true);
    setError(null);
    try {
      await sendJson('/api/admin/ingestion', 'POST', { kind: 'recalibrate_difficulty' });
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Sheet>
        <SheetHeader title={t.admin.ingestion} />
        <SheetBody className="p-0">
          {error && (
            <div className="px-5 pt-4">
              <Alert tone="error">{error}</Alert>
            </div>
          )}

          {jobs.length === 0 ? (
            <EmptyState
              tone="neutral"
              title={t.admin.ingestionEmpty}
              className="m-4 border-0 bg-transparent"
            />
          ) : (
            <ul className="ruled">
              {jobs.map((job) => (
                <li key={job.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {job.sourceLabel ?? job.kind}
                      </p>
                      <p className="text-[12px] text-ink-faint">
                        {[job.subjectName, job.kind, formatDate(job.createdAt)]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>

                    <Badge
                      tone={
                        job.status === 'succeeded'
                          ? 'correct'
                          : job.status === 'failed'
                            ? 'mark'
                            : 'partial'
                      }
                    >
                      {job.status}
                    </Badge>
                  </div>

                  {job.itemsTotal > 0 && (
                    <div className="mt-2">
                      <Meter
                        value={job.itemsProcessed / job.itemsTotal}
                        size="sm"
                        caption={`${job.itemsProcessed} / ${job.itemsTotal}${job.itemsFailed > 0 ? ` · ${job.itemsFailed}` : ''}`}
                      />
                    </div>
                  )}

                  {job.errorMessage && (
                    <p className="mt-2 text-[12.5px] text-mark">{job.errorMessage}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SheetBody>
      </Sheet>

      <div className="space-y-5">
        <Sheet>
          <SheetHeader title={t.admin.ingestionTrigger} />
          <form ref={formRef} onSubmit={ingest}>
            <SheetBody className="space-y-3">
              <Field label={t.admin.targetSubject} required>
                {({ id }) => (
                  <Select id={id} name="subjectId" required>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label={t.admin.itemType} required>
                {({ id }) => (
                  <Select id={id} name="kind" defaultValue="exam_paper" required>
                    <option value="exam_paper">{t.oldCycles.title}</option>
                    <option value="course_material">{t.settings.references}</option>
                  </Select>
                )}
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t.oldCycles.year}>
                  {({ id }) => <Input id={id} name="year" type="number" min="1990" max="2100" />}
                </Field>
                <Field label={t.oldCycles.session}>
                  {({ id }) => <Input id={id} name="session" placeholder="session1" />}
                </Field>
              </div>

              <Field label={t.settings.uploadReference} required>
                {({ id }) => (
                  <Input
                    id={id}
                    name="file"
                    type="file"
                    accept="application/pdf,text/plain,image/png,image/jpeg,image/webp"
                    required
                    className="h-auto py-2"
                  />
                )}
              </Field>
            </SheetBody>

            <SheetFooter className="justify-end">
              <Button type="submit" variant="primary" size="sm" loading={busy}>
                {t.admin.ingestionTrigger}
              </Button>
            </SheetFooter>
          </form>
        </Sheet>

        <Sheet>
          <SheetHeader title={t.admin.audit} />
          <SheetBody className="space-y-2">
            <Button size="sm" fullWidth onClick={backfillEmbeddings} loading={busy}>
              {t.settings.referenceProcessing}
            </Button>
            <Button size="sm" fullWidth onClick={recalibrate} loading={busy}>
              {t.practice.difficulty}
            </Button>
          </SheetBody>
        </Sheet>
      </div>
    </div>
  );
}
