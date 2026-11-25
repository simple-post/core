-- Commit the enum value before using it in a grant.
BEGIN;
ALTER TYPE "Feature" ADD VALUE IF NOT EXISTS 'POST_ANALYTICS';
COMMIT;

-- An operator may stage one verified user before deploying a private pilot.
-- Existing clients must not see an unknown enum in their active feature grants.
DO $$
BEGIN
  IF to_regclass('"_post_analytics_pilot"') IS NOT NULL THEN
    INSERT INTO "user_feature" ("userId", "feature")
      SELECT "userId", 'POST_ANALYTICS' FROM "_post_analytics_pilot"
      ON CONFLICT ("userId", "feature") DO NOTHING;
    DROP TABLE "_post_analytics_pilot";
  END IF;
END $$;
