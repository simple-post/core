-- Store the SimplePost source for quote posts. Platform-native target IDs are
-- intentionally resolved later from the source post's accountResults.
ALTER TABLE "post" ADD COLUMN "quotePostId" TEXT;

CREATE INDEX "post_quotePostId_idx" ON "post"("quotePostId");

ALTER TABLE "post"
ADD CONSTRAINT "post_quotePostId_fkey"
FOREIGN KEY ("quotePostId") REFERENCES "post"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
