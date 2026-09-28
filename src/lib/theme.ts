/**
 * Light or dark, chosen by the student and remembered per device.
 *
 * A cookie rather than localStorage so the server can stamp the theme on
 * <html> before the first paint — a student who chose dark never sees a white
 * flash on every page load. A cookie rather than an account column for the
 * same reason as the interface language: it is a display preference of this
 * screen, not a fact about the student.
 *
 * Light is the default, not the device setting. This is shown on other
 * people's machines and projectors, where nobody controls the OS setting; see
 * the note in the root layout.
 */
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = 'bac2_theme';
export const DEFAULT_THEME: Theme = 'light';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}
