-- Empty by design: permissions must come from an approved server-side source.
-- No historical backfill, automatic grants, or changes to checkout.
CREATE TABLE "openai_ads_measurement" (
    "userId" TEXT NOT NULL,
    "permissionGrantedAt" TIMESTAMP(3) NOT NULL,
    "permissionRevokedAt" TIMESTAMP(3),
    "reportedKinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "skippedKinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "openai_ads_measurement_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "openai_ads_measurement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "openai_ads_measurement_nextAttemptAt_idx" ON "openai_ads_measurement"("nextAttemptAt");
