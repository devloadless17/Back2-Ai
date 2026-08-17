-- Lexical search alongside the vector search.
--
-- Embeddings alone are weakest exactly where this corpus is hardest. Measured
-- per subject before this migration, a passage retrieved its own sentence in
-- the top five 85% of the time in French and 77% in English, but only 66% in
-- Arabic — a third of the corpus quietly worse than the rest. Mathematics sits
-- low for the same underlying reason: a page of notation carries little for a
-- sentence embedding to hold on to, while the one term that identifies it —
-- "المفعول المطلق", "photoélectrique", "\int" — is an exact string.
--
-- A term match is cheap and exact, so the two are complementary: the vector
-- finds passages that mean the same thing, the index finds passages that use
-- the same word.
--
-- The text is folded first. Arabic spells one word several ways — تَعْريف and
-- تعريف, إسلام and اسلام — and a lexical index over the display form matches
-- none of them. This is the same fold applied before embedding, in SQL, so the
-- two indexes agree on what a word is.

CREATE OR REPLACE FUNCTION fold_arabic(input text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT regexp_replace(
    translate(
      normalize(input, NFKC),
      -- Folded to a letter:  alef forms, alef maqsura, taa marbuta, Arabic digits
      E'أإآٱىة٠١٢٣٤٥٦٧٨٩'
      -- Removed entirely: tatweel, then the short vowels and sukun
      || E'ـًٌٍَُِّْٰ',
      E'اااايه' || '0123456789'
    ),
    '[[:space:]]+', ' ', 'g')
$$;

-- Stored rather than computed per query: the whole point is an index, and an
-- index needs a column that exists.
ALTER TABLE "content_chunks"
  ADD COLUMN IF NOT EXISTS "search_text" text
  GENERATED ALWAYS AS (fold_arabic(coalesce(title, '') || ' ' || content_text)) STORED;

ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "search_text" text
  GENERATED ALWAYS AS (fold_arabic(content_text)) STORED;

-- 'simple' rather than a language configuration on purpose. The corpus is three
-- languages in one table and a French stemmer applied to Arabic does damage; a
-- plain token index over folded text does the job for all three.
CREATE INDEX IF NOT EXISTS "content_chunks_search_idx"
  ON "content_chunks" USING gin (to_tsvector('simple', "search_text"));

CREATE INDEX IF NOT EXISTS "questions_search_idx"
  ON "questions" USING gin (to_tsvector('simple', "search_text"));
