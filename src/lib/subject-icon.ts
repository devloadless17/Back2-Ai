/**
 * An icon for a subject, from its name.
 *
 * WHY A NAME AND NOT A COLUMN. `subjects` has no icon field, and adding one
 * would mean a migration, a seeder change and an admin screen so that somebody
 * can type an emoji — for a value that is a pure function of the subject. The
 * sixty rows in this corpus are eighteen distinct subjects in three languages,
 * and every one of them is named unambiguously.
 *
 * MATCHED ON A DISTINCTIVE FRAGMENT, not on the whole name, because the same
 * subject is written several ways across the corpus: "Mathematiques",
 * "Mathematics", "الرياضيات", "Math". Order matters — "Sciences de la vie" must
 * be tested before "Sciences", or biology gets the general-science icon.
 *
 * A subject nobody matched gets a book rather than nothing. An empty slot in a
 * grid of icons reads as a loading failure; a plain book reads as a subject.
 */

/** Ordered: the first pattern that matches wins. Most specific first. */
const ICONS: { test: RegExp; icon: string }[] = [
  // Sciences. `vie`/`life` before the generic science words.
  { test: /sciences de la vie|life science|علوم الحياة|svt/i, icon: '🧬' },
  { test: /chimie|chemistry|كيمياء/i, icon: '🧪' },
  { test: /physique|physics|فيزياء/i, icon: '⚛️' },
  { test: /math|رياضيات/i, icon: '📐' },

  // Humanities. Arabic literature before the bare "arabe".
  { test: /أدب عربي|arabic literature/i, icon: '✍️' },
  { test: /فلسفة|philosoph/i, icon: '💭' },
  { test: /تاريخ|histoire|history/i, icon: '🏛️' },
  { test: /جغرافيا|g[ée]ographie|geography/i, icon: '🗺️' },
  { test: /تربية وطنية|civic|instruction civique/i, icon: '⚖️' },
  { test: /اقتصاد|economi|économie/i, icon: '📊' },
  { test: /اجتماع|sociolog/i, icon: '👥' },

  // Languages.
  { test: /فرنسي|fran[çc]ais|french/i, icon: '📖' },
  { test: /إنكليزي|انكليزي|english|anglais/i, icon: '📚' },
  { test: /عربي|arabe|arabic/i, icon: '✍️' },
];

export function subjectIcon(name: string): string {
  for (const entry of ICONS) {
    if (entry.test.test(name)) return entry.icon;
  }
  return '📘';
}
