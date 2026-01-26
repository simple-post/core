-- CreateTable
CREATE TABLE "pending_oauth_connection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "pending_oauth_connection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_oauth_connection_userId_platform_idx" ON "pending_oauth_connection"("userId", "platform");

-- CreateIndex
CREATE INDEX "pending_oauth_connection_expiresAt_idx" ON "pending_oauth_connection"("expiresAt");

-- AddForeignKey
ALTER TABLE "pending_oauth_connection" ADD CONSTRAINT "pending_oauth_connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
