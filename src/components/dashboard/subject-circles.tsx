import Link from 'next/link';
import type { CSSProperties, ReactNode, SVGProps } from 'react';

/**
 * The dashboard's subjects: one soft circle per subject, its icon inside and
 * its name underneath, in a centred row.
 *
 * Replaces the large ring cards. A student opening the app is choosing what to
 * study, and a row of labelled circles reads at a glance where a grid of cards
 * with bands and counts read as a report. Progress stays, small and quiet, under
 * the name — and only once the subject has been practised, because "0%" under
 * every circle on a first visit is a wall of failure.
 */

export type SubjectCircle = {
  subjectId: string;
  subjectName: string;
  /** 0–1, mean chapter mastery. */
  mastery: number;
  attemptsCount: number;
};

export function SubjectCircles({ subjects }: { subjects: SubjectCircle[] }) {
  return (
    <ul className="flex flex-wrap justify-center gap-x-6 gap-y-7 sm:gap-x-9">
      {subjects.map((subject) => {
        const look = lookFor(subject.subjectName);
        return (
          <li key={subject.subjectId} className="w-20">
            <Link
              href={`/practice/${subject.subjectId}`}
              className="group flex flex-col items-center gap-2.5 text-center"
              style={{ '--hue': look.hue } as CSSProperties}
            >
              <span className="subject-circle flex h-16 w-16 items-center justify-center rounded-full transition-transform duration-150 group-hover:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-primary">
                <SubjectGlyph width={26} height={26}>{look.glyph}</SubjectGlyph>
              </span>
              <span className="text-meta font-medium leading-tight text-ink" dir="auto">
                {subject.subjectName}
              </span>
              {subject.attemptsCount > 0 && (
                <span className="numeric -mt-1.5 text-micro text-ink-faint">
                  {Math.round(subject.mastery * 100)}%
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function SubjectGlyph({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/*
 * Hues, few on purpose: blue is the default, and colour is kept for the
 * subjects a student looks for first. Matched on a fragment of the name in any
 * of the three languages, like `subjectIcon`, most specific first.
 */
const BLUE = 221;
const ORANGE = 32;
const RED = 4;
const GREEN = 145;
const VIOLET = 265;
const TEAL = 185;

const BOOK = (
  <>
    <path d="M12 6.5c-1.8-1.3-4.4-1.8-7.5-1.5v12.5c3.1-.3 5.7.2 7.5 1.5 1.8-1.3 4.4-1.8 7.5-1.5V5c-3.1-.3-5.7.2-7.5 1.5Z" />
    <path d="M12 6.5V19" />
  </>
);

const LOOKS: { test: RegExp; hue: number; glyph: ReactNode }[] = [
  {
    test: /sciences de la vie|life science|علوم الحياة|svt/i,
    hue: GREEN,
    glyph: (
      <>
        <path d="M8 3c0 6 8 6 8 12s-8 6-8 6" />
        <path d="M16 3c0 6-8 6-8 12s8 6 8 6" />
        <path d="M9.5 7.5h5M9.5 16.5h5" />
      </>
    ),
  },
  {
    test: /chimie|chemistry|كيمياء/i,
    hue: TEAL,
    glyph: (
      <>
        <path d="M9.5 3.5h5M10 3.5v6l-5 8.5a1.5 1.5 0 0 0 1.3 2.3h11.4a1.5 1.5 0 0 0 1.3-2.3L14 9.5v-6" />
        <path d="M7.5 15h9" />
      </>
    ),
  },
  {
    test: /physique|physics|فيزياء/i,
    hue: BLUE,
    glyph: (
      <>
        <circle cx="12" cy="12" r="1.4" />
        <ellipse cx="12" cy="12" rx="9" ry="3.6" />
        <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-60 12 12)" />
      </>
    ),
  },
  {
    test: /math|رياضيات/i,
    hue: RED,
    glyph: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2.5" />
        <rect x="8" y="6" width="8" height="3.5" rx="1" />
        <path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 17h.01M12 17h.01M15.5 17h.01" strokeWidth="2.4" />
      </>
    ),
  },
  {
    test: /فلسفة|philosoph/i,
    hue: RED,
    glyph: (
      <>
        <path d="M9 18.5h6M10 21h4" />
        <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2v.5h5V16c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3Z" />
      </>
    ),
  },
  {
    test: /تاريخ|histoire|history/i,
    hue: VIOLET,
    glyph: (
      <>
        <path d="M3.5 9 12 4l8.5 5" />
        <path d="M5.5 9.5v8M9.8 9.5v8M14.2 9.5v8M18.5 9.5v8" />
        <path d="M3.5 20h17" />
      </>
    ),
  },
  {
    test: /جغرافيا|g[ée]ographie|geography/i,
    hue: GREEN,
    glyph: (
      <>
        <path d="M3.5 6.5 9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5L3.5 20Z" />
        <path d="M9 4v13.5M15 6.5V20" />
      </>
    ),
  },
  {
    test: /تربية وطنية|civic|instruction civique/i,
    hue: VIOLET,
    glyph: (
      <>
        <path d="M12 4v16M8 20h8M5 7h14" />
        <path d="m5 7-2.5 6a2.5 2.5 0 0 0 5 0Zm14 0-2.5 6a2.5 2.5 0 0 0 5 0Z" />
      </>
    ),
  },
  {
    test: /اقتصاد|economi|économie/i,
    hue: TEAL,
    glyph: <path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6" />,
  },
  {
    test: /اجتماع|sociolog/i,
    hue: ORANGE,
    glyph: (
      <>
        <circle cx="9" cy="8.5" r="3" />
        <path d="M3.5 19.5c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8" />
        <path d="M15.5 5.8a3 3 0 0 1 0 5.4M17 14.9c1.8.6 3 2.2 3.5 4.6" />
      </>
    ),
  },
  {
    test: /إنكليزي|انكليزي|english|anglais|فرنسي|fran[çc]ais|french/i,
    hue: BLUE,
    glyph: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5s1.1-6.1 3.5-8.5Z" />
      </>
    ),
  },
  {
    test: /عربي|arabe|arabic|أدب/i,
    hue: ORANGE,
    glyph: (
      <>
        <path d="M4 5h8M8 3.5V5c0 4-2 7-4.5 8.5M6 9c1 2 3 3.5 5.5 4" />
        <path d="m12 20.5 4-9 4 9M13.5 17.5h5" />
      </>
    ),
  },
];

function lookFor(name: string): { hue: number; glyph: ReactNode } {
  return LOOKS.find((look) => look.test.test(name)) ?? { hue: BLUE, glyph: BOOK };
}
