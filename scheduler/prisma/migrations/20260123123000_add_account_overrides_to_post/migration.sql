-- Add accountOverrides JSON column to posts
ALTER TABLE "post" ADD COLUMN "accountOverrides" JSONB;
