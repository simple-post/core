-- Automatic no-credit-card trial granted on first sign-in. One row per user,
-- created once: an expired row is what prevents a second trial.
CREATE TABLE "free_trial" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "free_trial_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "free_trial_dates_check" CHECK ("expiresAt" > "startsAt")
);

CREATE UNIQUE INDEX "free_trial_userId_key" ON "free_trial"("userId");
CREATE INDEX "free_trial_expiresAt_idx" ON "free_trial"("expiresAt");

ALTER TABLE "free_trial" ADD CONSTRAINT "free_trial_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
