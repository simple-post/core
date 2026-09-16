-- Cached social activity is linked to its authenticated owner, connected
-- account, and (for SimplePost post comments) the locally published post.
CREATE TABLE "social_activity_item" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "postId" TEXT,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "nativeId" TEXT NOT NULL,
    "nativePostId" TEXT NOT NULL,
    "nativeUrl" TEXT,
    "body" TEXT NOT NULL,
    "author" JSONB,
    "providerData" JSONB,
    "createdAtNative" TIMESTAMP(3),
    "canReply" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "social_activity_item_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "social_post_metric" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "nativePostId" TEXT NOT NULL,
    "nativeUrl" TEXT,
    "values" JSONB,
    "coverage" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    CONSTRAINT "social_post_metric_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "social_activity_sync" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "targetSnapshot" JSONB,
    "targetIndex" INTEGER NOT NULL DEFAULT 0,
    "commentCursors" JSONB,
    "mentionCursor" TEXT,
    "lastCommentsSyncAt" TIMESTAMP(3),
    "lastMentionsSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "social_activity_sync_pkey" PRIMARY KEY ("id")
);
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
CREATE UNIQUE INDEX "social_activity_item_accountId_kind_nativeId_key" ON "social_activity_item"("accountId", "kind", "nativeId");
CREATE INDEX "social_activity_item_userId_kind_createdAtNative_idx" ON "social_activity_item"("userId", "kind", "createdAtNative");
CREATE INDEX "social_activity_item_postId_createdAtNative_idx" ON "social_activity_item"("postId", "createdAtNative");
CREATE UNIQUE INDEX "social_post_metric_accountId_nativePostId_key" ON "social_post_metric"("accountId", "nativePostId");
CREATE INDEX "social_post_metric_userId_postId_fetchedAt_idx" ON "social_post_metric"("userId", "postId", "fetchedAt");
CREATE UNIQUE INDEX "social_activity_sync_accountId_key" ON "social_activity_sync"("accountId");
CREATE UNIQUE INDEX "social_activity_reply_userId_idempotencyKey_key" ON "social_activity_reply"("userId", "idempotencyKey");
CREATE INDEX "social_activity_reply_activityItemId_createdAt_idx" ON "social_activity_reply"("activityItemId", "createdAt");
ALTER TABLE "social_activity_item" ADD CONSTRAINT "social_activity_item_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_activity_item" ADD CONSTRAINT "social_activity_item_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "connected_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_activity_item" ADD CONSTRAINT "social_activity_item_postId_fkey" FOREIGN KEY ("postId") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_post_metric" ADD CONSTRAINT "social_post_metric_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_post_metric" ADD CONSTRAINT "social_post_metric_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "connected_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_post_metric" ADD CONSTRAINT "social_post_metric_postId_fkey" FOREIGN KEY ("postId") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_activity_sync" ADD CONSTRAINT "social_activity_sync_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "connected_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_activity_reply" ADD CONSTRAINT "social_activity_reply_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_activity_reply" ADD CONSTRAINT "social_activity_reply_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "connected_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_activity_reply" ADD CONSTRAINT "social_activity_reply_activityItemId_fkey" FOREIGN KEY ("activityItemId") REFERENCES "social_activity_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
