-- Additive, prospective observations. Do not replay unobserved historical first use.
ALTER TABLE "user" ADD COLUMN "analyticsExcluded" BOOLEAN NOT NULL DEFAULT false;
UPDATE "user" SET "analyticsExcluded" = true WHERE "isAdmin" = true;
ALTER TABLE activation_milestone
  ADD COLUMN "firstToolCalledAt" TIMESTAMP(3),
  ADD COLUMN "firstToolSucceededAt" TIMESTAMP(3),
  ADD COLUMN "firstPostAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "secondPublishingDayAt" TIMESTAMP(3);
UPDATE activation_milestone SET "reportedKinds" = "reportedKinds" ||
  ARRAY['tool_called','tool_succeeded','post_attempted','repeat_published'];

CREATE TABLE funnel_event (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  kind TEXT NOT NULL,
  channel TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  properties JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);
CREATE INDEX "funnel_event_userId_kind_occurredAt_idx" ON funnel_event("userId",kind,"occurredAt");
CREATE INDEX "funnel_event_kind_occurredAt_idx" ON funnel_event(kind,"occurredAt");
CREATE INDEX "funnel_event_occurredAt_idx" ON funnel_event("occurredAt");

CREATE OR REPLACE FUNCTION activation_record(p_user TEXT, p_kind TEXT, p_at TIMESTAMP(3), p_detail TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_kind = 'ai_connected' THEN
    UPDATE "activation_milestone" SET "aiConnectedAt" = p_at, "aiClient" = left(p_detail, 100), "updatedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = p_user AND ("aiConnectedAt" IS NULL OR "aiConnectedAt" > p_at);
  ELSIF p_kind = 'social_connected' THEN
    UPDATE "activation_milestone" SET "socialConnectedAt" = p_at, "socialPlatform" = left(p_detail, 40), "updatedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = p_user AND ("socialConnectedAt" IS NULL OR "socialConnectedAt" > p_at);
  ELSIF p_kind = 'post_created' THEN
    UPDATE "activation_milestone" SET "firstPostCreatedAt" = p_at, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = p_user AND ("firstPostCreatedAt" IS NULL OR "firstPostCreatedAt" > p_at);
  ELSIF p_kind = 'post_scheduled' THEN
    UPDATE "activation_milestone" SET "firstPostScheduledAt" = p_at, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = p_user AND ("firstPostScheduledAt" IS NULL OR "firstPostScheduledAt" > p_at);
  ELSIF p_kind = 'post_published' THEN
    UPDATE "activation_milestone" SET
      "firstPostPublishedAt" = LEAST("firstPostPublishedAt", p_at),
      "secondPublishingDayAt" = CASE
        WHEN "firstPostPublishedAt" IS NULL THEN "secondPublishingDayAt"
        WHEN p_at::date > "firstPostPublishedAt"::date THEN LEAST("secondPublishingDayAt", p_at)
        WHEN p_at::date < "firstPostPublishedAt"::date THEN LEAST("secondPublishingDayAt", "firstPostPublishedAt")
        ELSE "secondPublishingDayAt" END,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "userId" = p_user AND (
      "firstPostPublishedAt" IS NULL OR "firstPostPublishedAt" > p_at OR
      (p_at::date > "firstPostPublishedAt"::date AND ("secondPublishingDayAt" IS NULL OR "secondPublishingDayAt" > p_at))
    );
  ELSIF p_kind = 'subscription_started' THEN
    UPDATE "activation_milestone" SET "subscriptionStartedAt" = p_at, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = p_user AND ("subscriptionStartedAt" IS NULL OR "subscriptionStartedAt" > p_at);
  END IF;
END;
$$;

-- First/repeat success remains in activation_milestone. Only failure attempts need a new lifecycle observation.
CREATE FUNCTION funnel_post_failed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='failed' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'failed') THEN
    INSERT INTO funnel_event(id,"userId",kind,channel,"occurredAt")
      SELECT md5('post_failed:' || NEW.id || ':' || NEW."updatedAt"::text), NEW."userId", 'post_failed', 'database', NEW."updatedAt"
      WHERE EXISTS (SELECT 1 FROM "user" WHERE id=NEW."userId" AND acquisition IS NOT NULL AND NOT "isAdmin" AND NOT "analyticsExcluded")
      ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Optional post-failure measurement failed (%)', SQLSTATE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER funnel_post_failed AFTER INSERT OR UPDATE OF status ON post
  FOR EACH ROW EXECUTE FUNCTION funnel_post_failed();
