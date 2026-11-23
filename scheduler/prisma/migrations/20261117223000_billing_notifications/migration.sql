CREATE TABLE "billing_notification" (
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "firstAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "message" JSONB,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    CONSTRAINT "billing_notification_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "billing_notification_status_nextAttemptAt_idx" ON "billing_notification"("status", "nextAttemptAt");
CREATE INDEX "billing_notification_userId_idx" ON "billing_notification"("userId");
ALTER TABLE "billing_notification" ADD CONSTRAINT "billing_notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
