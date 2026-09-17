'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { IconChart, IconChat, IconDashboard, IconPractice } from '@/components/shell/icons';
import { TutorAvatar } from '@/components/chat/tutor-avatar';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';

/**
 * Primary navigation on a phone.
 *
 * WHY THIS EXISTS. The real student is on a phone, on patchy data, at eleven at
 * night. Until now the phone got a hamburger that opened the full desktop rail —
 * every route in the product, four sections deep, behind a tap. That is a
 * desktop navigation shown on a smaller screen, not a mobile design, and it
 * makes the four things a student actually does cost two interactions each.
 *
 * FOUR DESTINATIONS, AND NOTHING ELSE. Today, Study, Nour, Progress. They are
 * the student's mental model — where do I start, what do I practise, who do I
 * ask, where do I stand — and everything else in the product is reachable
 * underneath one of them or from the drawer, which stays exactly as it was.
 * Nothing is removed; the drawer is still there behind the menu button.
 *
 * NOUR CARRIES THE FACE, not a speech bubble. It is the one destination that is
 * a someone rather than a section, and the avatar is already drawn to survive
 * 22px — which is the size it is used at here.
 *
 * NO BADGES. A count on a tab bar is a standing request for attention, and this
 * product is used by people who are already anxious. The dashboard carries the
 * due-flashcard figure; it does not need to follow them onto every screen.
 */

type Destination = {
  href: string;
  /** Also matched on its prefix, so a chapter page still lights up Study. */
  match: string[];
  label: string;
  icon: 'today' | 'study' | 'nour' | 'progress';
};

export function BottomNav() {
  const { t } = useI18n();
  const pathname = usePathname() ?? '';

  const destinations: Destination[] = [
    {
      href: '/dashboard',
      match: ['/dashboard'],
      label: t.nav.sections.today,
      icon: 'today',
    },
    {
      /*
       * Practice is the entry, but Study covers summaries, flashcards, past
       * papers and the worksheet builder too — a student who lands on any of
       * them should see where they are, not a dead tab bar.
       */
      href: '/practice',
      match: ['/practice', '/summaries', '/flashcards', '/old-cycles', '/worksheet', '/exam-sim'],
      label: t.nav.sections.study,
      icon: 'study',
    },
    {
      href: '/chat',
      match: ['/chat', '/upload'],
      label: t.nav.tutorShort,
      icon: 'nour',
    },
    {
      href: '/progress',
      match: ['/progress', '/performance', '/report', '/schedule', '/todos'],
      label: t.nav.sections.progress,
      icon: 'progress',
    },
  ];

  const isActive = (d: Destination) =>
    d.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  return (
    <nav
      aria-label={t.nav.dashboard}
      /*
       * `pb-[env(safe-area-inset-bottom)]` so the bar clears the iPhone home
       * indicator rather than sitting under it. Without it the last four pixels
       * of every tap target are unreachable on the device most of these students
       * are holding.
       */
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper-raised/95 backdrop-blur',
        'pb-[env(safe-area-inset-bottom)] lg:hidden',
      )}
    >
      <ul className="flex">
        {destinations.map((d) => {
          const active = isActive(d);
          return (
            <li key={d.href} className="flex-1">
              <Link
                href={d.href}
                aria-current={active ? 'page' : undefined}
                /*
                 * 56px tall before the safe-area padding. Comfortably above the
                 * 44px floor, because this is tapped with a thumb by somebody
                 * who is tired.
                 */
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-0.5 text-micro transition-colors',
                  active ? 'text-primary' : 'text-ink-faint hover:text-ink-muted',
                )}
              >
                <Glyph kind={d.icon} active={active} />
                <span className="leading-none">{d.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Glyph({ kind, active }: { kind: Destination['icon']; active: boolean }) {
  if (kind === 'nour') {
    /*
     * The tutor's own face, not a chat glyph. `ink="paper"` knocks the eyes and
     * mouth out in the surface colour, which is what this avatar expects when it
     * is drawn on paper rather than on a filled button.
     */
    return (
      <TutorAvatar
        size={22}
        ink="paper"
        mood={active ? 'attentive' : 'idle'}
        className={active ? 'text-primary' : 'text-ink-faint'}
      />
    );
  }

  const Icon =
    kind === 'today' ? IconDashboard : kind === 'study' ? IconPractice : IconChart;
  return <Icon width={21} height={21} />;
}
