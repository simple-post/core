-- CreateTable
CREATE TABLE "post_analytics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platformPostId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "message" TEXT,
    "views" INTEGER,
    "reach" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "quotes" INTEGER,
    "saves" INTEGER,
    "clicks" INTEGER,
    "profileVisits" INTEGER,
    "follows" INTEGER,
    "watchTimeSeconds" DOUBLE PRECISION,
    "averageWatchTimeSeconds" DOUBLE PRECISION,
    "engagements" INTEGER,
    "platformMetrics" JSONB,
    "fetchedAt" TIMESTAMP(3),
    "nextRefreshAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_analytics_snapshot" (
    "id" TEXT NOT NULL,
    "analyticsId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" INTEGER,
    "reach" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "quotes" INTEGER,
    "saves" INTEGER,
    "clicks" INTEGER,
    "profileVisits" INTEGER,
    "follows" INTEGER,
    "watchTimeSeconds" DOUBLE PRECISION,
    "averageWatchTimeSeconds" DOUBLE PRECISION,
    "engagements" INTEGER,

    CONSTRAINT "post_analytics_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_analytics_snapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "followers" INTEGER,
    "following" INTEGER,
    "posts" INTEGER,
    "totalViews" INTEGER,
    "totalLikes" INTEGER,
    "platformMetrics" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_analytics_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "post_analytics_userId_publishedAt_idx" ON "post_analytics"("userId", "publishedAt");

-- CreateIndex
CREATE INDEX "post_analytics_userId_platform_publishedAt_idx" ON "post_analytics"("userId", "platform", "publishedAt");

-- CreateIndex
CREATE INDEX "post_analytics_nextRefreshAt_idx" ON "post_analytics"("nextRefreshAt");

-- CreateIndex
CREATE INDEX "post_analytics_accountId_idx" ON "post_analytics"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "post_analytics_postId_accountId_key" ON "post_analytics"("postId", "accountId");

-- CreateIndex
CREATE INDEX "post_analytics_snapshot_analyticsId_capturedAt_idx" ON "post_analytics_snapshot"("analyticsId", "capturedAt");

-- CreateIndex
CREATE INDEX "post_analytics_snapshot_userId_capturedAt_idx" ON "post_analytics_snapshot"("userId", "capturedAt");

-- CreateIndex
CREATE INDEX "account_analytics_snapshot_userId_day_idx" ON "account_analytics_snapshot"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "account_analytics_snapshot_accountId_day_key" ON "account_analytics_snapshot"("accountId", "day");

-- AddForeignKey
ALTER TABLE "post_analytics" ADD CONSTRAINT "post_analytics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_analytics" ADD CONSTRAINT "post_analytics_postId_fkey" FOREIGN KEY ("postId") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_analytics" ADD CONSTRAINT "post_analytics_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "connected_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_analytics_snapshot" ADD CONSTRAINT "post_analytics_snapshot_analyticsId_fkey" FOREIGN KEY ("analyticsId") REFERENCES "post_analytics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_analytics_snapshot" ADD CONSTRAINT "account_analytics_snapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_analytics_snapshot" ADD CONSTRAINT "account_analytics_snapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "connected_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

