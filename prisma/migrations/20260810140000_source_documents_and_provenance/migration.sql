-- Provenance for ingested curriculum material.
--
-- The product may only say things it can trace to real curriculum material.
-- Until now a chunk recorded its origin as a filename in content_chunks.source_ref
-- and a question recorded nothing at all, which cannot answer "which book, which
-- edition, which page" when a teacher disputes an item.

CREATE TABLE "source_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sha256" TEXT NOT NULL,
    "book_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publisher" TEXT,
    "language" "language" NOT NULL,
    -- Several books serve two tracks: chemistry and physics are shared by GS and
    -- LS, and three books are shared by LH and SE. The book is one row; the
    -- chapters it feeds exist once per track.
    "tracks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "subject_name" TEXT NOT NULL,
    "page_count" INTEGER NOT NULL,
    "first_published" INTEGER,
    "impression" INTEGER,
    "source_url" TEXT,
    "retrieved_at" DATE,
    "licence_note" TEXT,
    "reader" TEXT,
    "storage_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "source_documents_sha256_key" ON "source_documents"("sha256");
CREATE UNIQUE INDEX "source_documents_book_key_key" ON "source_documents"("book_key");

ALTER TABLE "questions"
    ADD COLUMN "source_document_id" UUID,
    ADD COLUMN "source_page_from" INTEGER,
    ADD COLUMN "source_page_to" INTEGER;

ALTER TABLE "content_chunks"
    ADD COLUMN "source_document_id" UUID,
    ADD COLUMN "source_page_from" INTEGER,
    ADD COLUMN "source_page_to" INTEGER;

-- SET NULL rather than CASCADE: losing the provenance row must never delete the
-- curriculum content that references it.
ALTER TABLE "questions"
    ADD CONSTRAINT "questions_source_document_id_fkey"
    FOREIGN KEY ("source_document_id") REFERENCES "source_documents"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "content_chunks"
    ADD CONSTRAINT "content_chunks_source_document_id_fkey"
    FOREIGN KEY ("source_document_id") REFERENCES "source_documents"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "questions_source_document_id_idx" ON "questions"("source_document_id");
CREATE INDEX "content_chunks_source_document_id_idx" ON "content_chunks"("source_document_id");
