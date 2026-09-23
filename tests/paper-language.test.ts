import { describe, expect, it } from 'vitest';

import { languageOfText } from '../scripts/corpus/paper-language-rules';

/*
 * The five readings that decided 44 papers.
 *
 * Every case below is a real row from the corpus, shortened. They are here
 * because the obvious version of this test — "French words and no English
 * ones" — passes on the clean papers and gets the awkward ones exactly
 * backwards, which would have moved 40-odd English papers into the French
 * course on the strength of one word.
 */
describe('reading what language a paper is printed in', () => {
  it('reads an English paper that quotes one French word as English', () => {
    // GS Chemistry 2005, stamped .fr on the strength of the "la" in the title.
    const text =
      'The Industrial Face of Chemistry. Chemistry is a base of an industrial and ' +
      'commercial activity which is of great importance to the economy, and that is ' +
      'why the products are studied with care. Extract from la Revue de Chimie.';
    expect(languageOfText(text)).toBe('en');
  });

  it('reads a French paper as French', () => {
    const text =
      'Sujet : Les vieux ne sont pas la seule categorie qui souffre du milieu social. ' +
      'Vous direz dans une composition argumentee quels sont les problemes des jeunes, ' +
      'et vous appuierez votre propos sur des exemples pris dans les textes du corpus.';
    expect(languageOfText(text)).toBe('fr');
  });

  it('refuses a row that holds both printings at once', () => {
    // Not a failure to decide. The row is the defect, and no edition can own it.
    const text =
      'Fuel and a power plant. The object of this exercise is to compare the masses of ' +
      'different fuels that are used in a power plant, and to answer with the data. ' +
      'Combustible et centrale. Le but de cet exercice est de comparer les masses des ' +
      'differents combustibles utilises dans une centrale, pour repondre aux questions.';
    expect(languageOfText(text)).toBe('mixed');
  });

  it('refuses it when the second printing is Arabic rather than French', () => {
    // LS Mathematiques 2015: 88% Arabic letters over an English exercise. Read by
    // Arabic share alone this is an Arabic maths paper, and there is no Arabic
    // maths course — a true statement about a false premise.
    const english =
      'Let g be the function defined on IR. Show that g is strictly increasing and set ' +
      'up the table of variations of g, then study the sign of g according to the values.';
    const arabic = 'أدرس حسب قيم المتغير موقع البيان بالنسبة للمستقيم وحدد النهاية وبين أن المستقيم هو المقارب المائل للبيان ثم أنشئ جدول التغير للدالة وارسم البيان في معلم متعامد ممنظم'.repeat(6);
    expect(languageOfText(`${english} ${arabic}`)).toBe('mixed');
  });

  it('declines to read a correction sheet that is nothing but numbers', () => {
    // It travels with its paper instead, on the cycle's vote. Deciding where a
    // whole paper goes on one stray word is how this damage was done.
    expect(languageOfText('Q Correction Note 1-a 24 3 81P 00M ; 50 5 8PH 08 ; 14 7 80P')).toBeNull();
  });
});
