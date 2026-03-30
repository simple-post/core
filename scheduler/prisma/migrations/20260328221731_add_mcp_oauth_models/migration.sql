-- CreateTable
CREATE TABLE "mcp_oauth_client" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_oauth_client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_authorization_code" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "scope" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_authorization_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_access_token" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_access_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_oauth_client_clientId_key" ON "mcp_oauth_client"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_authorization_code_codeHash_key" ON "mcp_authorization_code"("codeHash");

-- CreateIndex
CREATE INDEX "mcp_authorization_code_expiresAt_idx" ON "mcp_authorization_code"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_access_token_tokenHash_key" ON "mcp_access_token"("tokenHash");

-- CreateIndex
CREATE INDEX "mcp_access_token_userId_idx" ON "mcp_access_token"("userId");

-- CreateIndex
CREATE INDEX "mcp_access_token_expiresAt_idx" ON "mcp_access_token"("expiresAt");

-- AddForeignKey
ALTER TABLE "mcp_authorization_code" ADD CONSTRAINT "mcp_authorization_code_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "mcp_oauth_client"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_access_token" ADD CONSTRAINT "mcp_access_token_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "mcp_oauth_client"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_access_token" ADD CONSTRAINT "mcp_access_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
