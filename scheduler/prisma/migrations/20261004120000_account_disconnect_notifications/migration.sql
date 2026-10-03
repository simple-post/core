CREATE TABLE "account_disconnect_notification" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "disconnectedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "firstAttemptAt" TIMESTAMP(3),
    "message" JSONB,
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "account_disconnect_notification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_disconnect_notification_status_check" CHECK ("status" IN ('pending', 'sent', 'cancelled', 'failed'))
);
CREATE UNIQUE INDEX "account_disconnect_notification_accountId_disconnectedAt_key" ON "account_disconnect_notification"("accountId", "disconnectedAt");
CREATE INDEX "account_disconnect_notification_status_nextAttemptAt_idx" ON "account_disconnect_notification"("status", "nextAttemptAt");
ALTER TABLE "account_disconnect_notification" ADD CONSTRAINT "account_disconnect_notification_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "connected_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
