CREATE TABLE "tiktok_upload_init_attempt" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tiktok_upload_init_attempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tiktok_upload_init_attempt_accountId_createdAt_idx"
    ON "tiktok_upload_init_attempt"("accountId", "createdAt");
CREATE INDEX "tiktok_upload_init_attempt_createdAt_idx"
    ON "tiktok_upload_init_attempt"("createdAt");
