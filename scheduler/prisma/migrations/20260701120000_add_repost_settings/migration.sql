-- CreateTable
CREATE TABLE "user_repost_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "delayHours" INTEGER NOT NULL DEFAULT 12,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_repost_settings_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "post"
ADD COLUMN "repostEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "repostDelayHours" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN "repostDueAt" TIMESTAMP(3),
ADD COLUMN "repostStatus" TEXT NOT NULL DEFAULT 'not_applicable',
ADD COLUMN "repostedAt" TIMESTAMP(3),
ADD COLUMN "repostResults" JSONB,
ADD COLUMN "repostErrorMessage" TEXT,
ADD COLUMN "repostErrorDetails" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "user_repost_settings_userId_key" ON "user_repost_settings"("userId");

-- CreateIndex
CREATE INDEX "post_repostStatus_repostDueAt_idx" ON "post"("repostStatus", "repostDueAt");

-- AddForeignKey
ALTER TABLE "user_repost_settings" ADD CONSTRAINT "user_repost_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
