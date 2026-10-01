ALTER TABLE "user" ADD COLUMN "experimentAttribution" TEXT;
CREATE TABLE "experiment_exposure" (
  "id" TEXT PRIMARY KEY,
  "experimentId" TEXT NOT NULL,
  "variant" TEXT NOT NULL CHECK ("variant" IN ('a', 'b')),
  "assignedAt" TIMESTAMP(3) NOT NULL,
  "exposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "experiment_exposure_experimentId_exposedAt_idx" ON "experiment_exposure" ("experimentId", "exposedAt");
-- Connection/publication outcomes reuse the existing activation_milestone triggers.
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
