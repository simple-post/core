ALTER TABLE "post" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);
ALTER TABLE "publish_checkpoint"
  ADD COLUMN "leaseId" TEXT,
  ADD COLUMN "recoveryProvider" TEXT,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "progress" JSONB,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "recoveryStartedAt" TIMESTAMP(3);
CREATE INDEX "post_status_scheduledFor_nextAttemptAt_idx" ON "post"("status", "scheduledFor", "nextAttemptAt");
