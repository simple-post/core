ALTER TABLE "user" ADD COLUMN "experimentAttribution" TEXT;
CREATE TABLE "experiment_exposure" (
  "id" TEXT PRIMARY KEY,
  "experimentId" TEXT NOT NULL,
  "variant" TEXT NOT NULL CHECK ("variant" IN ('a', 'b')),
  "assignedAt" TIMESTAMP(3) NOT NULL,
  "exposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "experiment_exposure_experimentId_exposedAt_idx" ON "experiment_exposure" ("experimentId", "exposedAt");
CREATE TABLE "experiment_milestone" (
  "userId" TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "firstConnectedAt" TIMESTAMP(3),
  "firstPublishedAt" TIMESTAMP(3)
);
-- All publishing entry points use these tables, including MCP and scheduled dispatch.
-- Conflict updates retain the earliest milestone under concurrent publishes/connections.
CREATE FUNCTION record_experiment_milestone() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "user" WHERE "id" = NEW."userId" AND "experimentAttribution" IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'connected_account' THEN
    INSERT INTO "experiment_milestone" ("userId", "firstConnectedAt") VALUES (NEW."userId", NEW."createdAt")
    ON CONFLICT ("userId") DO UPDATE SET "firstConnectedAt" = LEAST("experiment_milestone"."firstConnectedAt", EXCLUDED."firstConnectedAt");
  ELSIF NEW."status" = 'published' AND NEW."publishedAt" IS NOT NULL THEN
    INSERT INTO "experiment_milestone" ("userId", "firstPublishedAt") VALUES (NEW."userId", NEW."publishedAt")
    ON CONFLICT ("userId") DO UPDATE SET "firstPublishedAt" = LEAST("experiment_milestone"."firstPublishedAt", EXCLUDED."firstPublishedAt");
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER experiment_connected AFTER INSERT ON "connected_account" FOR EACH ROW EXECUTE FUNCTION record_experiment_milestone();
CREATE TRIGGER experiment_published AFTER INSERT OR UPDATE OF "status", "publishedAt" ON "post" FOR EACH ROW EXECUTE FUNCTION record_experiment_milestone();
-- Remove the pseudonymous exposure linked to an account when that account is deleted.
CREATE FUNCTION delete_experiment_exposure() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."experimentAttribution" IS NOT NULL THEN
    DELETE FROM "experiment_exposure" WHERE "id" = (OLD."experimentAttribution"::jsonb ->> 'assignmentId');
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER experiment_user_deleted AFTER DELETE ON "user" FOR EACH ROW EXECUTE FUNCTION delete_experiment_exposure();
