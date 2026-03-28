-- CreateTable
CREATE TABLE "cli_token" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'CLI',
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cli_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cli_token_tokenHash_key" ON "cli_token"("tokenHash");

-- CreateIndex
CREATE INDEX "cli_token_userId_idx" ON "cli_token"("userId");

-- AddForeignKey
ALTER TABLE "cli_token" ADD CONSTRAINT "cli_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
