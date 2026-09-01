-- What the student calls their tutor.
--
-- Nullable with no default: null is "never named it", which is a different
-- state from "named it back to the default" and the UI shows the same string
-- for both. Additive and nullable, so it deploys against a live database
-- without taking a lock worth worrying about.
ALTER TABLE "users" ADD COLUMN "tutor_name" TEXT;
