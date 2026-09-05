-- Prisma timestamps have millisecond precision. Preserve their use as optimistic
-- versions even when two updates occur in the same millisecond or clocks differ.
CREATE FUNCTION advance_post_updated_at() RETURNS trigger AS $$
BEGIN
  NEW."updatedAt" := GREATEST(NEW."updatedAt", OLD."updatedAt" + INTERVAL '1 millisecond');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER post_monotonic_updated_at BEFORE UPDATE ON "post"
FOR EACH ROW EXECUTE FUNCTION advance_post_updated_at();
CREATE INDEX "publish_attempt_createdAt_idx" ON "publish_attempt"("createdAt");
CREATE INDEX "publish_attempt_postId_createdAt_idx" ON "publish_attempt"("postId", "createdAt");
