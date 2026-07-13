-- Database-managed plan grants that do not require Stripe.
CREATE TABLE "complimentary_access_invite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "accessDurationDays" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "redeemedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complimentary_access_invite_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "complimentary_access_invite_planKey_check" CHECK ("planKey" IN ('basic', 'advanced', 'pro')),
    CONSTRAINT "complimentary_access_invite_duration_check" CHECK ("accessDurationDays" > 0)
);

CREATE TABLE "complimentary_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "inviteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complimentary_access_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "complimentary_access_planKey_check" CHECK ("planKey" IN ('basic', 'advanced', 'pro')),
    CONSTRAINT "complimentary_access_dates_check" CHECK ("expiresAt" > "startsAt")
);

CREATE UNIQUE INDEX "complimentary_access_invite_code_key" ON "complimentary_access_invite"("code");
CREATE INDEX "complimentary_access_invite_expiresAt_idx" ON "complimentary_access_invite"("expiresAt");
CREATE INDEX "complimentary_access_invite_redeemedByUserId_idx" ON "complimentary_access_invite"("redeemedByUserId");
CREATE UNIQUE INDEX "complimentary_access_userId_key" ON "complimentary_access"("userId");
CREATE UNIQUE INDEX "complimentary_access_inviteId_key" ON "complimentary_access"("inviteId");
CREATE INDEX "complimentary_access_expiresAt_idx" ON "complimentary_access"("expiresAt");

ALTER TABLE "complimentary_access_invite" ADD CONSTRAINT "complimentary_access_invite_redeemedByUserId_fkey" FOREIGN KEY ("redeemedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "complimentary_access" ADD CONSTRAINT "complimentary_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "complimentary_access" ADD CONSTRAINT "complimentary_access_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "complimentary_access_invite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
