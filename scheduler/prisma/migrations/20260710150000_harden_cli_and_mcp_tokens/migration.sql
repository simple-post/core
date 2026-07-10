-- AlterTable
ALTER TABLE "cli_token" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "cli_token" ADD COLUMN "revokedAt" TIMESTAMP(3);
ALTER TABLE "cli_token" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing CLI tokens get the same 90-day lifetime as newly issued tokens.
UPDATE "cli_token" SET "expiresAt" = CURRENT_TIMESTAMP + INTERVAL '90 days' WHERE "expiresAt" IS NULL;
ALTER TABLE "cli_token" ALTER COLUMN "expiresAt" SET NOT NULL;

-- CreateTable
CREATE TABLE "cli_authorization_code" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cli_authorization_code_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "mcp_access_token" ADD COLUMN "revokedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "cli_authorization_code_codeHash_key" ON "cli_authorization_code"("codeHash");
CREATE INDEX "cli_authorization_code_expiresAt_idx" ON "cli_authorization_code"("expiresAt");
CREATE INDEX "cli_token_expiresAt_idx" ON "cli_token"("expiresAt");

-- AddForeignKey
ALTER TABLE "cli_authorization_code" ADD CONSTRAINT "cli_authorization_code_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
