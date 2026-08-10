'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { sendJson } from '@/lib/client/request';
import { useI18n } from '@/lib/i18n/client';

/**
 * To-dos, with optional chapter links.
 *
 * A linked item is a link: tapping it goes to the practice, flashcards or
 * simulation screen for that chapter. That is the entire reason the link exists
 * — the gap between "I should revise integrals" and being on the integrals
 * page is where revision plans die.
 *
 * Completion is optimistic. Ticking a box should feel instant; a spinner
 * between the tap and the strike-through makes a fifty-item list unusable.
 */

export type TodoItem = {
  id: string;
  content: string;
  isDone: boolean;
  linkedAction: 'quiz' | 'flashcards' | 'practice' | 'exam_sim' | null;
  chapterId: string | null;
  chapterName: string | null;
  subjectId: string | null;
};

export function TodoList({
  todos,
  chapters,
}: {
  todos: TodoItem[];
  chapters: { id: string; subjectId: string; name: string }[];
}) {
  const { t } = useI18n();
  const router = useRouter();

  const [items, setItems] = useState(todos);
  const [content, setContent] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [action, setAction] = useState<TodoItem['linkedAction']>('practice');
  const [showCompleted, setShowCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const visible = showCompleted ? items : items.filter((item) => !item.isDone);
  const doneCount = items.filter((item) => item.isDone).length;

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!content.trim()) return;

    setAdding(true);
    setError(null);

    try {
      const created = await sendJson<{ id: string }>('/api/todos', 'POST', {
        content: content.trim(),
        linkedChapterId: chapterId || null,
        linkedAction: chapterId ? action : null,
      });

      const chapter = chapters.find((c) => c.id === chapterId);

      setItems((current) => [
        {
          id: created.id,
          content: content.trim(),
          isDone: false,
          linkedAction: chapterId ? action : null,
          chapterId: chapterId || null,
          chapterName: chapter?.name ?? null,
          subjectId: chapter?.subjectId ?? null,
        },
        ...current,
      ]);
      setContent('');
      setChapterId('');
    } catch {
      setError(t.common.unknownError);
    } finally {
      setAdding(false);
    }
  }

  async function toggle(item: TodoItem) {
    const next = !item.isDone;
    setItems((current) => current.map((i) => (i.id === item.id ? { ...i, isDone: next } : i)));

    try {
      await sendJson(`/api/todos/${item.id}`, 'PATCH', { isDone: next });
    } catch {
      // Put it back rather than leaving the UI claiming something that is not true.
      setItems((current) => current.map((i) => (i.id === item.id ? { ...i, isDone: !next } : i)));
      setError(t.common.unknownError);
    }
  }

  async function remove(id: string) {
    const snapshot = items;
    setItems((current) => current.filter((i) => i.id !== id));
    try {
      await sendJson(`/api/todos/${id}`, 'DELETE');
      router.refresh();
    } catch {
      setItems(snapshot);
      setError(t.common.unknownError);
    }
  }

  function hrefFor(item: TodoItem): string | null {
    if (!item.chapterId || !item.subjectId) return null;
    switch (item.linkedAction) {
      case 'flashcards':
        return `/flashcards/review?scope=chapter&id=${item.chapterId}`;
      case 'exam_sim':
        return '/exam-sim/new';
      case 'quiz':
        return `/practice/${item.subjectId}/${item.chapterId}/quiz`;
      case 'practice':
      default:
        return `/practice/${item.subjectId}/${item.chapterId}`;
    }
  }

  return (
    <div className="space-y-5">
      {error && <Alert tone="error">{error}</Alert>}

      <Sheet>
        <SheetBody>
          <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={t.todos.placeholder}
              className="flex-1"
              aria-label={t.todos.placeholder}
            />
            <Select
              value={chapterId}
              onChange={(event) => setChapterId(event.target.value)}
              className="sm:w-56"
              aria-label={t.todos.linkChapter}
            >
              <option value="">{t.todos.noLink}</option>
              {chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.name}
                </option>
              ))}
            </Select>
            {chapterId && (
              <Select
                value={action ?? 'practice'}
                onChange={(event) => setAction(event.target.value as TodoItem['linkedAction'])}
                className="sm:w-40"
                aria-label={t.todos.linkAction}
              >
                <option value="practice">{t.todos.actionPractice}</option>
                <option value="flashcards">{t.todos.actionFlashcards}</option>
                <option value="quiz">{t.todos.actionQuiz}</option>
                <option value="exam_sim">{t.todos.actionExamSim}</option>
              </Select>
            )}
            <Button type="submit" variant="primary" loading={adding}>
              {t.todos.add}
            </Button>
          </form>
        </SheetBody>
      </Sheet>

      <Sheet>
        <SheetHeader
          title={t.todos.title}
          actions={
            doneCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowCompleted((current) => !current)}
                className="text-[12.5px] font-medium text-primary underline-offset-2 hover:underline"
              >
                {showCompleted ? t.todos.hideCompleted : t.todos.showCompleted}
              </button>
            ) : null
          }
        />
        <SheetBody className="p-0">
          {visible.length === 0 ? (
            <EmptyState
              tone={items.length > 0 ? 'positive' : 'neutral'}
              title={items.length > 0 ? t.todos.allDone : t.todos.empty}
              body={items.length > 0 ? undefined : t.todos.emptyHint}
              className="m-4 border-0 bg-transparent"
            />
          ) : (
            <ul className="ruled">
              {visible.map((item) => {
                const href = hrefFor(item);

                return (
                  <li key={item.id} className="flex items-start gap-3 px-5 py-3">
                    <input
                      type="checkbox"
                      checked={item.isDone}
                      onChange={() => toggle(item)}
                      className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                      aria-label={item.content}
                    />

                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'text-sm text-ink transition-colors duration-200',
                          item.isDone && 'text-ink-faint line-through',
                        )}
                      >
                        {item.content}
                      </p>

                      {item.chapterName && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {href ? (
                            <Link
                              href={href}
                              className="text-[12px] font-medium text-primary underline-offset-2 hover:underline"
                            >
                              {item.chapterName}
                            </Link>
                          ) : (
                            <span className="text-[12px] text-ink-faint">{item.chapterName}</span>
                          )}
                          {item.linkedAction && (
                            <Badge tone="neutral">
                              {item.linkedAction === 'flashcards'
                                ? t.todos.actionFlashcards
                                : item.linkedAction === 'quiz'
                                  ? t.todos.actionQuiz
                                  : item.linkedAction === 'exam_sim'
                                    ? t.todos.actionExamSim
                                    : t.todos.actionPractice}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => remove(item.id)}
                      className="shrink-0 rounded px-2 py-0.5 text-[12px] text-ink-faint transition-colors hover:text-mark"
                    >
                      {t.common.delete}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </SheetBody>
      </Sheet>
    </div>
  );
}
