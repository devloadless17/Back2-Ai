-- Announcements can address several tracks at once.
--
-- Before this, `announcements.target_track_id` held one track or null, where
-- null meant everyone. An admin announcing one changed exam date to GS and LS
-- had to post it twice. Two posts drift: one gets edited, one does not, and a
-- student in the wrong track reads the stale one.
--
-- Empty audience still means every track, so every existing row that targeted
-- nobody in particular keeps behaving exactly as it did.

CREATE TABLE "announcement_tracks" (
    "announcement_id" UUID NOT NULL,
    "track_id" UUID NOT NULL,

    CONSTRAINT "announcement_tracks_pkey" PRIMARY KEY ("announcement_id","track_id")
);

CREATE INDEX "announcement_tracks_track_id_idx" ON "announcement_tracks"("track_id");

ALTER TABLE "announcement_tracks" ADD CONSTRAINT "announcement_tracks_announcement_id_fkey"
    FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "announcement_tracks" ADD CONSTRAINT "announcement_tracks_track_id_fkey"
    FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill before the column goes, so a single-track announcement keeps the
-- exact audience it was posted to. Announcements with a null target had no row
-- to carry and correctly end up with none.
INSERT INTO "announcement_tracks" ("announcement_id", "track_id")
SELECT "id", "target_track_id"
  FROM "announcements"
 WHERE "target_track_id" IS NOT NULL;

ALTER TABLE "announcements" DROP CONSTRAINT "announcements_target_track_id_fkey";
ALTER TABLE "announcements" DROP COLUMN "target_track_id";
