'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { sendJson } from '@/lib/client/request';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';

export type AdminChapter = {
  id: string;
  name: string;
  subjectId: string;
  subjectName: string;
  trackCode: string | null;
  /** Arabic subject names have to set right-to-left in this list. */
  language: string;
  unitName: string | null;
  questionCount: number;
  attemptCount: number;
  cancelledAt: string | null;
  cancelledReason: string | null;
};

export type AdminSubjectOption = { id: string; label: string };

/**
 * Cancelling chapters the ministry has cut from the programme.
 *
 * NOTHING IS DELETED, and the list says so on every row it is about to hide.
 * A chapter carries questions, passages, and whatever mastery students already
 * earned against it; a reduced syllabus is reversed the following year as often
 * as not. So the control is a toggle, and the counts beside it are what the
 * admin is deciding about — cancelling a chapter 200 students have worked
 * through is a different act from cancelling an empty one, and there is no
 * second screen where that becomes apparent.
 *
 * A REASON IS ASKED FOR, NOT REQUIRED. Six months on, "cancelled" alone does
 * not say whether the ministry cut it or somebody filed it in error, and those
 * two are undone differently. Requiring it would only buy a list full of "x".
 */
export function ChapterManager({
  chapters,
  subjects,
  subjectId,
}: {
  chapters: AdminChapter[];
  subjects: AdminSubjectOption[];
  subjectId: string;
}) {
  const { t } = useI18n();
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  async function toggle(chapter: AdminChapter) {
    setError(null);
    setBusy(chapter.id);
    try {
      await sendJson('/api/admin/chapters', 'PATCH', {
        chapterId: chapter.id,
        cancelled: chapter.cancelledAt === null,
        reason: reasons[chapter.id]?.trim() || null,
      });
      router.refresh();
    } catch {
      setError(t.common.unknownError);
    } finally {
      setBusy(null);
    }
  }

  const cancelledCount = chapters.filter((c) => c.cancelledAt !== null).length;

  return (
    <Sheet>
      <SheetHeader
        title={t.admin.chapters}
        description={
          subjectId
            ? t.admin.chaptersCancelledCount
                .replace('{cancelled}', String(cancelledCount))
                .replace('{total}', String(chapters.length))
            : t.admin.chaptersPickSubject
        }
      />

      <SheetBody className="p-0">
        <div className="px-5 py-4">
          {/* A plain GET form: the chosen subject is the URL, so an admin can
              come back to the same list or send it to somebody. */}
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="block min-w-60 flex-1">
              <span className="text-caption font-medium text-ink">{t.admin.targetSubject}</span>
              <Select name="subject" defaultValue={subjectId} className="mt-1">
                <option value="">—</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" variant="secondary" size="sm">
              {t.common.search}
            </Button>
          </form>
        </div>

        {error && (
          <div className="px-5 pb-3">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        {!subjectId ? (
          <EmptyState
            tone="neutral"
            title={t.admin.chaptersPickSubject}
            className="m-4 border-0 bg-transparent"
          />
        ) : chapters.length === 0 ? (
          <EmptyState
            tone="neutral"
            title={t.admin.chaptersEmpty}
            className="m-4 border-0 bg-transparent"
          />
        ) : (
          <ul className="ruled">
            {chapters.map((chapter) => {
              const cancelled = chapter.cancelledAt !== null;
              return (
                <li
                  key={chapter.id}
                  className={cn('px-5 py-3.5', cancelled && 'bg-paper-sunken')}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p
                        // The chapter's own name carries its direction; the row
                        // around it keeps the admin's.
                        dir={chapter.language === 'ar' ? 'rtl' : 'ltr'}
                        className={cn(
                          'text-sm font-medium',
                          cancelled ? 'text-ink-muted line-through' : 'text-ink',
                        )}
                      >
                        {chapter.name}
                      </p>

                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-faint">
                        {chapter.unitName && <span>{chapter.unitName}</span>}
                        {/*
                          WHAT IS BEHIND IT. Shown before the decision, not
                          after: these are the students and the material the
                          cancel is about.
                        */}
                        <span>
                          {t.admin.chapterQuestions.replace(
                            '{count}',
                            String(chapter.questionCount),
                          )}
                        </span>
                        <span>
                          {t.admin.chapterAttempts.replace(
                            '{count}',
                            String(chapter.attemptCount),
                          )}
                        </span>
                        {cancelled && <Badge tone="mark">{t.admin.chapterCancelled}</Badge>}
                      </p>

                      {cancelled && chapter.cancelledReason && (
                        <p className="mt-1 text-caption text-ink-muted">
                          {chapter.cancelledReason}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {!cancelled && (
                        <Input
                          value={reasons[chapter.id] ?? ''}
                          onChange={(event) =>
                            setReasons((current) => ({
                              ...current,
                              [chapter.id]: event.target.value,
                            }))
                          }
                          maxLength={300}
                          placeholder={t.admin.chapterReasonPlaceholder}
                          aria-label={t.admin.chapterReasonPlaceholder}
                          className="h-8 w-56 text-caption"
                        />
                      )}
                      <Button
                        type="button"
                        variant={cancelled ? 'secondary' : 'quiet'}
                        size="sm"
                        loading={busy === chapter.id}
                        onClick={() => toggle(chapter)}
                        className={cn(!cancelled && 'text-mark hover:text-mark')}
                      >
                        {cancelled ? t.admin.chapterRestore : t.admin.chapterCancel}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SheetBody>
    </Sheet>
  );
}
