-- AlterTable
ALTER TABLE "user" ADD COLUMN "stripeCustomerId" TEXT;

-- CreateTable
CREATE TABLE "user_subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "stripeProductId" TEXT,
    "planKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'incomplete',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_stripeCustomerId_key" ON "user"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "user_subscription_userId_key" ON "user_subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_subscription_stripeSubscriptionId_key" ON "user_subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "user_subscription_stripeCustomerId_idx" ON "user_subscription"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "user_subscription_status_idx" ON "user_subscription"("status");

-- AddForeignKey
ALTER TABLE "user_subscription" ADD CONSTRAINT "user_subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
