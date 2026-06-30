-- CreateTable
CREATE TABLE "post" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountOptions" JSONB,

    CONSTRAINT "post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_file" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ConnectedAccountToPost" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ConnectedAccountToPost_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "post_userId_status_idx" ON "post"("userId", "status");

-- CreateIndex
CREATE INDEX "post_userId_scheduledFor_idx" ON "post"("userId", "scheduledFor");

-- CreateIndex
CREATE INDEX "media_file_postId_idx" ON "media_file"("postId");

-- CreateIndex
CREATE INDEX "_ConnectedAccountToPost_B_index" ON "_ConnectedAccountToPost"("B");

-- AddForeignKey
ALTER TABLE "post" ADD CONSTRAINT "post_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_file" ADD CONSTRAINT "media_file_postId_fkey" FOREIGN KEY ("postId") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ConnectedAccountToPost" ADD CONSTRAINT "_ConnectedAccountToPost_A_fkey" FOREIGN KEY ("A") REFERENCES "connected_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ConnectedAccountToPost" ADD CONSTRAINT "_ConnectedAccountToPost_B_fkey" FOREIGN KEY ("B") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
