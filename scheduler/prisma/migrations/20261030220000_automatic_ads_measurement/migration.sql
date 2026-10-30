-- Keep historical consent and explicit opt-outs intact. Automatic enrollment
-- deliberately has no customer-consent timestamp. No customer backfill here.
ALTER TABLE openai_ads_measurement
  ADD COLUMN "enrollmentMode" TEXT NOT NULL DEFAULT 'consent',
  ALTER COLUMN "permissionGrantedAt" DROP NOT NULL;
ALTER TABLE openai_ads_measurement ADD CONSTRAINT openai_ads_enrollment_mode_check CHECK (
  ("enrollmentMode" = 'consent' AND "permissionGrantedAt" IS NOT NULL) OR
  ("enrollmentMode" = 'automatic' AND "permissionGrantedAt" IS NULL)
);

CREATE OR REPLACE FUNCTION openai_ads_permission_window() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."enrollmentMode" = 'consent' AND NEW."enrollmentMode" <> 'consent' THEN
    RAISE EXCEPTION 'Existing consent cannot be replaced by automatic measurement' USING ERRCODE = '23514';
  END IF;
  IF NEW."permissionGrantedAt" < OLD."permissionGrantedAt"
     OR (OLD."permissionRevokedAt" IS NOT NULL AND NEW."permissionRevokedAt" IS NULL
         AND (NEW."enrollmentMode" = 'automatic' OR NEW."permissionGrantedAt" IS NULL
              OR NEW."permissionGrantedAt" <= OLD."permissionRevokedAt")) THEN
    RAISE EXCEPTION 'An existing opt-out cannot be automatically re-enabled' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER openai_ads_permission_window ON openai_ads_measurement;
CREATE TRIGGER openai_ads_permission_window
  BEFORE UPDATE OF "permissionGrantedAt", "permissionRevokedAt", "enrollmentMode"
  ON openai_ads_measurement FOR EACH ROW EXECUTE FUNCTION openai_ads_permission_window();
