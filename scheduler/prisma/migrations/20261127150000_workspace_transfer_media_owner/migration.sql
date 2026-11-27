ALTER TABLE "post" ADD COLUMN "storageOwnerId" TEXT;
CREATE INDEX "post_storageOwnerId_idx" ON "post"("storageOwnerId");
