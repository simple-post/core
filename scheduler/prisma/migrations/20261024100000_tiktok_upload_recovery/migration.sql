CREATE TABLE "tiktok_upload_pause" (
    "accountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "resumeAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tiktok_upload_pause_pkey" PRIMARY KEY ("accountId")
);
ALTER TABLE "post" ADD COLUMN "tiktokPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "post" ADD COLUMN "tiktokRetryApproved" BOOLEAN NOT NULL DEFAULT false;
