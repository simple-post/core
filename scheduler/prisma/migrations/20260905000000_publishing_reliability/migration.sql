CREATE TABLE "publish_attempt" (
  "id" TEXT PRIMARY KEY, "postId" TEXT NOT NULL, "platform" TEXT NOT NULL, "accountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "publish_attempt_platform_createdAt_idx" ON "publish_attempt"("platform", "createdAt");
CREATE TABLE "publish_checkpoint" (
  "postId" TEXT NOT NULL, "accountId" TEXT NOT NULL, "operation" TEXT NOT NULL,
  "segment" INTEGER NOT NULL, "fingerprint" TEXT NOT NULL, "state" TEXT NOT NULL,
  "result" JSONB, "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("postId", "accountId", "operation", "segment")
);
CREATE TABLE "storage_deletion" (
  "key" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "state" TEXT NOT NULL DEFAULT 'queued',
  "dueAt" TIMESTAMP(3) NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "storage_deletion_state_dueAt_idx" ON "storage_deletion"("state", "dueAt");
