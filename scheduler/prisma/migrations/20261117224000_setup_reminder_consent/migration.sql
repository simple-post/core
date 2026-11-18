ALTER TABLE "billing_notification"
    ADD COLUMN "consentRecipient" TEXT,
    ADD COLUMN "consentWithdrawnAt" TIMESTAMP(3);
