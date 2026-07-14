-- Keep refresh retry state queryable without exposing encrypted token metadata.
ALTER TABLE "connected_account"
ADD COLUMN "credentialRefreshRetryAt" TIMESTAMP(3),
ADD COLUMN "credentialRefreshBlockedAt" TIMESTAMP(3);

CREATE INDEX "connected_account_refresh_sweep_idx"
ON "connected_account"("credentialRefreshBlockedAt", "credentialRefreshRetryAt", "expiresAt");
