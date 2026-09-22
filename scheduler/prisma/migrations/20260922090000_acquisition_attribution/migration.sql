ALTER TABLE "user" ADD COLUMN "acquisition" TEXT;
CREATE TABLE "first_payment" (
    "userId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "amountPaid" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "planKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "first_payment_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "first_payment_positive_amount" CHECK ("amountPaid" > 0),
    CONSTRAINT "first_payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "first_payment_stripeInvoiceId_key" ON "first_payment"("stripeInvoiceId");
CREATE INDEX "first_payment_paidAt_idx" ON "first_payment"("paidAt");
