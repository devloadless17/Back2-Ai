import type { Metadata } from 'next';

import { TodoList, type TodoItem } from '@/components/todos/todo-list';
import { PageHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';

export const metadata: Metadata = { title: 'To-dos' };

export default async function TodosPage() {
  const user = await requireUser();
  const { t } = await getTranslations();

  const [todos, chapters] = await Promise.all([
    db.todo.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        content: true,
        isDone: true,
        linkedAction: true,
        linkedChapter: { select: { id: true, name: true, subjectId: true } },
      },
      orderBy: [{ isDone: 'asc' }, { createdAt: 'desc' }],
    }),
    db.chapter.findMany({
      where: { subject: { trackId: user.trackId ?? undefined } },
      select: { id: true, name: true, subjectId: true, subject: { select: { name: true } } },
      orderBy: [{ subjectId: 'asc' }, { orderIndex: 'asc' }],
    }),
  ]);

  const items: TodoItem[] = todos.map((todo) => ({
    id: todo.id,
    content: todo.content,
    isDone: todo.isDone,
    linkedAction: todo.linkedAction,
    chapterId: todo.linkedChapter?.id ?? null,
    chapterName: todo.linkedChapter?.name ?? null,
    subjectId: todo.linkedChapter?.subjectId ?? null,
  }));

  return (
    <>
      <PageHeader title={t.todos.title} description={t.todos.subtitle} />
      <TodoList
        todos={items}
        chapters={chapters.map((c) => ({
          id: c.id,
          subjectId: c.subjectId,
          name: `${c.subject.name} — ${c.name}`,
        }))}
      />
    </>
  );
}
