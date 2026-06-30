-- CreateTable
CREATE TABLE "connected_account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platformAccountId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenType" TEXT DEFAULT 'Bearer',
    "expiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "username" TEXT,
    "displayName" TEXT,
    "email" TEXT,
    "profilePicture" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connected_account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connected_account_userId_idx" ON "connected_account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "connected_account_userId_platform_platformAccountId_key" ON "connected_account"("userId", "platform", "platformAccountId");

-- AddForeignKey
ALTER TABLE "connected_account" ADD CONSTRAINT "connected_account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
