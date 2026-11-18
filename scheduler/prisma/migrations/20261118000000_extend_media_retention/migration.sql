-- Extend pending cleanup from its last queue or reference check.
-- Leave deletions already claimed or completed alone.
UPDATE "storage_deletion"
SET "dueAt" = "updatedAt" + INTERVAL '7 days'
WHERE "state" = 'queued'
  AND "dueAt" < "updatedAt" + INTERVAL '7 days';
