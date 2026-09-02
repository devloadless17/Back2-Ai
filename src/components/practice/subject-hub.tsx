import Link from 'next/link';

import { Badge } from '@/components/ui/feedback';
import { LanguageSwitcher } from '@/components/shell/language-switcher';
import {
  IconArchive,
  IconBook,
  IconCards,
  IconExam,
  IconPractice,
  IconShield,
  IconChat,
} from '@/components/shell/icons';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import type { SubjectHub as HubCounts } from '@/lib/queries/subject-hub';
import { cn } from '@/lib/cn';

/**
 * One subject, organised by what a student came to do.
 *
 * The page was a list of chapters. That answers "what is in this course", which
 * is a question nobody opens a revision app to ask — they open it to find out
 * what to do next, and a syllabus does not tell them. So the surfaces are
 * grouped under the three things a student is ever doing — learning it,
 * practising it, going back over what they got wrong — and the chapter list
 * keeps its place underneath, as the index it always was.
 *
 * Every card carries a real count, and that is the part worth defending. "Past
 * papers" is an invitation to click; "Past papers · none yet" saves the trip,
 * and "Question bank · 1,181 questions" is the difference between a menu and a
 * decision. All of them are plain reads, so the page never waits on a model and
 * never prints a figure it cannot substantiate.
 *
 * A card with nothing behind it is shown disabled rather than hidden. A student
 * who cannot find the past papers does not conclude there are none — they
 * conclude the app is broken, and go looking again tomorrow.
 *
 * Every card carries the subject with it. Three of them used to point at the
 * unscoped page — `/exam-sim/new`, `/old-cycles`, weak-spot cards — so opening
 * "Mock paper" from inside Chemistry landed on a picker asking which subject you
 * meant, and "Your mistakes" offered a deck drawn from every subject the student
 * takes. The hub is the subject's front door; a door that forgets which room it
 * is in is worse than no door, because the student has already answered.
 */
export async function SubjectHub({
  subjectId,
  subjectName,
  counts,
}: {
  subjectId: string;
  subjectName: string;
  counts: HubCounts;
}) {
  const { t } = await getTranslations();

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-4">
        <div className="min-w-0">
          <h1 className="text-title font-semibold sm:text-heading">{subjectName}</h1>
          <p className="text-meta text-ink-muted">
            {format(t.hub.subtitle, { chapters: counts.chapters, questions: counts.questions })}
          </p>
        </div>

        {/*
          The language switcher, on the page as well as in the sidebar.

          This is the screen a student lands on from the dashboard and stays on,
          and on a phone the sidebar is behind a menu button. Putting it here
          costs one row and removes a hunt. It switches the interface only — the
          questions and chapter names stay in the language the account studies
          in, which is locked. See `LanguageSwitcher`.
        */}
        <LanguageSwitcher />
      </div>

      <Section title={t.hub.learn}>
        <HubCard
          href={`/summaries/${subjectId}`}
          icon={IconBook}
          title={t.hub.book}
          hint={t.hub.bookHint}
          count={format(t.hub.chapterCount, { count: counts.chaptersWithMaterial })}
          disabled={counts.chaptersWithMaterial === 0}
          emptyHint={t.hub.bookEmpty}
        />
        <HubCard
          href={`/practice/${subjectId}#chapters`}
          icon={IconPractice}
          title={t.hub.index}
          hint={t.hub.indexHint}
          count={format(t.hub.chapterCount, { count: counts.chapters })}
        />
      </Section>

      <Section title={t.hub.practise}>
        <HubCard
          href={`/practice/${subjectId}#chapters`}
          icon={IconPractice}
          title={t.hub.bank}
          hint={t.hub.bankHint}
          count={format(t.hub.questionCount, { count: counts.questions })}
          disabled={counts.questions === 0}
          emptyHint={t.hub.bankEmpty}
        />
      </Section>

      {/*
        Sitting a paper is its own section, not a card filed under "Practise".
        It was called "Mock paper" there and went unrecognised — the rest of the
        product, the sidebar included, calls this an exam simulation, and a
        student looking for the exam simulator inside a subject had no reason to
        read "Mock paper" as the thing they wanted. Two cards, because sitting a
        past paper and sitting an assembled one are the same act to a student
        and were two sections apart.
      */}
      <Section title={t.hub.sit}>
        <HubCard
          href={`/exam-sim/new?subject=${subjectId}`}
          icon={IconExam}
          title={t.hub.mock}
          hint={t.hub.mockHint}
          count={counts.canAssemble ? t.hub.mockReady : t.hub.mockEmpty}
          disabled={!counts.canAssemble}
          emptyHint={t.hub.mockEmpty}
        />
        <HubCard
          href={`/old-cycles?subject=${subjectId}`}
          icon={IconArchive}
          title={t.hub.papers}
          hint={t.hub.papersHint}
          count={format(t.hub.paperCount, { count: counts.papers })}
          disabled={counts.papers === 0}
          emptyHint={t.hub.papersEmpty}
        />
      </Section>

      <Section title={t.hub.review}>
        <HubCard
          href={`/flashcards/review?scope=subject&id=${subjectId}`}
          icon={IconCards}
          title={t.hub.cards}
          hint={t.hub.cardsHint}
          count={
            counts.cardsDue > 0
              ? format(t.hub.cardsDue, { count: counts.cardsDue })
              : format(t.hub.cardCount, { count: counts.cardsTotal })
          }
          disabled={counts.cardsTotal === 0}
          emptyHint={t.hub.cardsEmpty}
          fallbackHref={`/practice/${subjectId}#chapters`}
          fallbackLabel={t.hub.startHere}
        />
        <HubCard
          href={`/flashcards/review?scope=weak&id=${subjectId}`}
          icon={IconShield}
          title={t.hub.mistakes}
          hint={t.hub.mistakesHint}
          count={
            counts.weakChapters > 0
              ? format(t.hub.weakCount, { count: counts.weakChapters })
              : t.hub.mistakesNone
          }
          tone={counts.weakChapters > 0 ? 'mark' : 'plain'}
          disabled={counts.weakChapters === 0}
          emptyHint={counts.attempts === 0 ? t.hub.mistakesUnknown : t.hub.mistakesNone}
          /*
           * Only the never-practised case gets a way forward. "Nothing flagged
           * — good" is not a problem to solve, and sending a student to the
           * question bank to fix it would be telling them their good result was
           * a fault.
           */
          fallbackHref={counts.attempts === 0 ? `/practice/${subjectId}#chapters` : undefined}
          fallbackLabel={counts.attempts === 0 ? t.hub.startHere : undefined}
        />
      </Section>

      {/*
        Asking, as a section of its own.

        The tutor floats on every screen, but a floating button is furniture —
        a student who has not pressed it does not know it is a tutor rather than
        a help widget. Named here, beside the other things this subject can do,
        it is the answer to "none of these cards is what I need", which is the
        moment a student would otherwise close the app.

        It goes to `/chat` rather than opening a session directly: this is a
        server component, and starting a conversation is a POST. The dock beside
        it does the anchored version, and knows which subject this is because
        the page publishes it — see `TutorAnchor`.
      */}
      <Section title={t.hub.ask}>
        <HubCard
          href="/chat"
          icon={IconChat}
          title={t.hub.ask}
          hint={t.hub.askHint}
          count={t.hub.askCount}
        />
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="label mb-2 px-1">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

/**
 * One thing a student can do, and how much of it there is.
 *
 * The disabled state is a card, not an absence: it keeps its place in the grid
 * and swaps the count for the reason. "Past papers — none ingested for this
 * subject yet" is a fact a student can act on; a missing tile is a bug they
 * report.
 */
function HubCard({
  href,
  icon: Icon,
  title,
  hint,
  count,
  disabled,
  emptyHint,
  tone = 'plain',
  fallbackHref,
  fallbackLabel,
}: {
  href: string;
  icon: typeof IconBook;
  title: string;
  hint: string;
  count: string;
  disabled?: boolean;
  emptyHint?: string;
  tone?: 'plain' | 'mark';
  /**
   * Where to go when the card is empty but the student can fill it.
   *
   * An empty deck and an empty question bank look identical on this page and
   * are not the same thing at all: one is waiting on the student, the other is
   * waiting on the corpus. Cards in the first group stay clickable and point at
   * the thing that fills them; only the second group is genuinely dead.
   */
  fallbackHref?: string;
  fallbackLabel?: string;
}) {
  const body = (
    <>
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
          disabled ? 'bg-paper-sunken text-ink-faint' : tone === 'mark' ? 'bg-mark-soft text-mark' : 'bg-primary-soft text-primary',
        )}
      >
        <Icon width={19} height={19} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-caption leading-snug text-ink-muted">
          {disabled ? (emptyHint ?? hint) : hint}
        </span>
        {!disabled ? (
          <span className="mt-1.5 inline-block">
            <Badge tone={tone === 'mark' ? 'mark' : 'neutral'}>{count}</Badge>
          </span>
        ) : fallbackHref && fallbackLabel ? (
          <span className="mt-1.5 inline-block">
            <Badge tone="neutral">{fallbackLabel}</Badge>
          </span>
        ) : null}
      </span>
    </>
  );

  /*
   * Empty, but the student can do something about it.
   *
   * Still a link, and readable. The dead version was `opacity-60` over a pale
   * card, which on the review section of a fresh subject meant two greyed
   * rectangles telling a student what they did not have and offering no way to
   * get it — the state every new account starts in.
   */
  if (disabled && fallbackHref) {
    return (
      <Link
        href={fallbackHref}
        className="sheet sheet-interactive pressable flex items-start gap-3 p-4"
      >
        {body}
      </Link>
    );
  }

  // Genuinely nothing behind it — no papers ingested, no course material. Shown
  // rather than hidden: a student who cannot find the past papers concludes the
  // app is broken, not that there are none.
  if (disabled) {
    return (
      <div
        aria-disabled="true"
        className="sheet flex cursor-not-allowed items-start gap-3 p-4 opacity-75"
      >
        {body}
      </div>
    );
  }

  return (
    <Link href={href} className="sheet sheet-interactive pressable flex items-start gap-3 p-4">
      {body}
    </Link>
  );
}
