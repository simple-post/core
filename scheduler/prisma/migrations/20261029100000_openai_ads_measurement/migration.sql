-- Empty by design: permissions must come from an approved server-side source.
-- No historical backfill, automatic grants, or changes to checkout.
CREATE TABLE "openai_ads_measurement" (
    "userId" TEXT NOT NULL,
    "permissionGrantedAt" TIMESTAMPTZ(3) NOT NULL,
    "permissionRevokedAt" TIMESTAMPTZ(3),
    "reportedKinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "skippedKinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "openai_ads_measurement_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "openai_ads_measurement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "openai_ads_measurement_nextAttemptAt_idx" ON "openai_ads_measurement"("nextAttemptAt");

-- Re-enabling permission must not include milestones reached during revocation.
CREATE FUNCTION openai_ads_permission_window() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."permissionGrantedAt" < OLD."permissionGrantedAt"
     OR (OLD."permissionRevokedAt" IS NOT NULL AND NEW."permissionRevokedAt" IS NULL
         AND NEW."permissionGrantedAt" <= OLD."permissionRevokedAt") THEN
    RAISE EXCEPTION 'OpenAI measurement re-grant must advance the permission window' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER openai_ads_permission_window BEFORE UPDATE OF "permissionGrantedAt", "permissionRevokedAt"
  ON "openai_ads_measurement" FOR EACH ROW EXECUTE FUNCTION openai_ads_permission_window();
