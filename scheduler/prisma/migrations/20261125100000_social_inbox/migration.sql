-- AlterEnum
ALTER TYPE "Feature" ADD VALUE 'SOCIAL_INBOX';

-- CreateTable
CREATE TABLE "social_activity_item" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "nativeId" TEXT NOT NULL,
    "nativePostId" TEXT NOT NULL,
    "nativeUrl" TEXT,
    "sourceUrl" TEXT,
    "body" TEXT NOT NULL,
    "author" JSONB,
    "providerData" JSONB,
    "createdAtNative" TIMESTAMP(3),
    "canReply" BOOLEAN NOT NULL DEFAULT false,
    "canLike" BOOLEAN NOT NULL DEFAULT false,
    "liked" BOOLEAN NOT NULL DEFAULT false,
    "likeStatus" TEXT,
    "likeAttemptAt" TIMESTAMP(3),
    "likeError" TEXT,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_activity_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_activity_sync" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "targetSnapshot" JSONB,
    "targetIndex" INTEGER NOT NULL DEFAULT 0,
    "providerCursor" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'comments',
    "lastSyncedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "retryAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "coverage" TEXT,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_activity_sync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_activity_reply" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "activityItemId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "nativeReplyId" TEXT,
    "nativeReplyUrl" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_activity_reply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_activity_item_userId_eventAt_id_idx" ON "social_activity_item"("userId", "eventAt", "id");

-- CreateIndex
CREATE INDEX "social_activity_item_userId_platform_eventAt_id_idx" ON "social_activity_item"("userId", "platform", "eventAt", "id");

-- CreateIndex
CREATE INDEX "social_activity_item_postId_createdAtNative_idx" ON "social_activity_item"("postId", "createdAtNative");

-- CreateIndex
CREATE UNIQUE INDEX "social_activity_item_accountId_nativeId_key" ON "social_activity_item"("accountId", "nativeId");

-- CreateIndex
CREATE UNIQUE INDEX "social_activity_sync_accountId_key" ON "social_activity_sync"("accountId");

-- CreateIndex
CREATE INDEX "social_activity_reply_activityItemId_createdAt_idx" ON "social_activity_reply"("activityItemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_activity_reply_userId_idempotencyKey_key" ON "social_activity_reply"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "social_activity_item" ADD CONSTRAINT "social_activity_item_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_activity_item" ADD CONSTRAINT "social_activity_item_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "connected_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_activity_item" ADD CONSTRAINT "social_activity_item_postId_fkey" FOREIGN KEY ("postId") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_activity_sync" ADD CONSTRAINT "social_activity_sync_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "connected_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_activity_reply" ADD CONSTRAINT "social_activity_reply_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_activity_reply" ADD CONSTRAINT "social_activity_reply_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "connected_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_activity_reply" ADD CONSTRAINT "social_activity_reply_activityItemId_fkey" FOREIGN KEY ("activityItemId") REFERENCES "social_activity_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- An unresolved public write blocks a new reply intent on the same item.
CREATE UNIQUE INDEX "social_activity_reply_in_flight_idx" ON "social_activity_reply"("activityItemId")
WHERE "status" IN ('pending', 'uncertain');
