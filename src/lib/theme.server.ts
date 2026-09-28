import { cookies } from 'next/headers';

import { DEFAULT_THEME, THEME_COOKIE, isTheme, type Theme } from '@/lib/theme';

/** The theme this device chose, read on the server so <html> is right on first paint. */
export async function getTheme(): Promise<Theme> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(value) ? value : DEFAULT_THEME;
}
