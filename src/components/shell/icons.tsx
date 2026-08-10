import type { SVGProps } from 'react';

/**
 * Inline icon set.
 *
 * Hand-drawn rather than pulling in an icon package: this keeps the dependency
 * surface small for security review, and lets the strokes match the hairline
 * rules used everywhere else in the design.
 *
 * All icons are 20×20 on a 1.6 stroke, decorative by default (aria-hidden) —
 * every icon in this app sits next to a text label.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
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

export function IconDashboard(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.75" y="2.75" width="6" height="6" rx="1" />
      <rect x="11.25" y="2.75" width="6" height="4" rx="1" />
      <rect x="2.75" y="11.25" width="6" height="6" rx="1" />
      <rect x="11.25" y="9.25" width="6" height="8" rx="1" />
    </Icon>
  );
}

export function IconPractice(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 3.5h8.5L16 7v9.5H4z" />
      <path d="M12.5 3.5V7H16" />
      <path d="M6.75 11h6.5M6.75 13.75h4" />
    </Icon>
  );
}

export function IconArchive(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.75" y="4" width="14.5" height="3.5" rx="1" />
      <path d="M4.25 7.5v7.75a1 1 0 0 0 1 1h9.5a1 1 0 0 0 1-1V7.5" />
      <path d="M8 10.5h4" />
    </Icon>
  );
}

export function IconExam(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="11" r="6.25" />
      <path d="M10 8v3l2 1.5" />
      <path d="M7.5 2.75h5" />
    </Icon>
  );
}

export function IconCards(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5.5" y="2.75" width="11.75" height="9" rx="1.25" />
      <path d="M13.5 16.5H4.25a1.5 1.5 0 0 1-1.5-1.5V6.5" />
    </Icon>
  );
}

export function IconChat(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M17 10.5c0 3.2-3.13 5.75-7 5.75-.9 0-1.77-.14-2.56-.4L3 17.25l1.2-3.1A5.4 5.4 0 0 1 3 10.5c0-3.17 3.13-5.75 7-5.75s7 2.58 7 5.75Z" />
    </Icon>
  );
}

export function IconCamera(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.75 6.75a1.5 1.5 0 0 1 1.5-1.5h1.9l1.1-1.75h5.5l1.1 1.75h1.9a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5H4.25a1.5 1.5 0 0 1-1.5-1.5Z" />
      <circle cx="10" cy="10.5" r="2.75" />
    </Icon>
  );
}

export function IconChart(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 16.5h14" />
      <path d="M5.75 16.5v-4.75M9.75 16.5V6.5M13.75 16.5v-7.5" />
    </Icon>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.75" y="4.25" width="14.5" height="13" rx="1.25" />
      <path d="M2.75 8h14.5M6.5 2.75v3M13.5 2.75v3" />
    </Icon>
  );
}

export function IconCheckList(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 5.75 4.5 7.25 7 4.5M3 13.75l1.5 1.5L7 12.5" />
      <path d="M9.75 6h7.25M9.75 14h7.25" />
    </Icon>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.75v1.9M10 15.35v1.9M17.25 10h-1.9M4.65 10h-1.9M15.13 4.87l-1.34 1.34M6.21 13.79l-1.34 1.34M15.13 15.13l-1.34-1.34M6.21 6.21 4.87 4.87" />
    </Icon>
  );
}

export function IconShield(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 2.75 16 5v4.75c0 3.4-2.4 6.35-6 7.5-3.6-1.15-6-4.1-6-7.5V5Z" />
      <path d="m7.5 10 1.75 1.75L12.75 8.5" />
    </Icon>
  );
}

export function IconBell(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.25 8.25a4.75 4.75 0 0 1 9.5 0c0 3.5 1.25 4.75 1.25 4.75H4s1.25-1.25 1.25-4.75Z" />
      <path d="M8.25 15.75a1.9 1.9 0 0 0 3.5 0" />
    </Icon>
  );
}

export function IconLogout(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5.5V4.25a1.5 1.5 0 0 0-1.5-1.5h-6a1.5 1.5 0 0 0-1.5 1.5v11.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5V14.5" />
      <path d="M8.25 10h9M14.5 7l3 3-3 3" />
    </Icon>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 5.5h14M3 10h14M3 14.5h14" />
    </Icon>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 5 10 10M15 5 5 15" />
    </Icon>
  );
}

export function IconChevron(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m7.5 4.5 5 5.5-5 5.5" />
    </Icon>
  );
}
