-- Additive measurement only. Historical attribution and reported browser events stay intact.
ALTER TABLE "user" ADD COLUMN "analyticsExcluded" BOOLEAN NOT NULL DEFAULT false;
UPDATE "user" SET "analyticsExcluded" = true WHERE "isAdmin" = true;
ALTER TABLE "activation_milestone"
  ADD COLUMN "relayLeaseToken" TEXT,
  ADD COLUMN "relayLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "relayAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "relayLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "relayLastError" TEXT;
CREATE TABLE "funnel_event" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  "properties" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);
CREATE INDEX "funnel_event_userId_kind_occurredAt_idx" ON "funnel_event"("userId", "kind", "occurredAt");
CREATE INDEX "funnel_event_kind_occurredAt_idx" ON "funnel_event"("kind", "occurredAt");
CREATE INDEX "funnel_event_occurredAt_idx" ON "funnel_event"("occurredAt");

-- Deterministic IDs make retries idempotent. No business operation is failed by optional measurement.
CREATE FUNCTION funnel_record(p_user TEXT, p_kind TEXT, p_key TEXT, p_at TIMESTAMP(3), p_props JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "user" WHERE id=p_user AND acquisition IS NOT NULL AND NOT "isAdmin" AND NOT "analyticsExcluded") THEN RETURN; END IF;
  INSERT INTO "funnel_event" (id,"userId",kind,channel,"occurredAt",properties)
    VALUES (md5('funnel:' || p_kind || ':' || p_key),p_user,p_kind,'database',p_at,p_props)
    ON CONFLICT (id) DO UPDATE SET
      properties=CASE WHEN EXCLUDED."occurredAt" < "funnel_event"."occurredAt" THEN EXCLUDED.properties ELSE "funnel_event".properties END,
      "occurredAt"=LEAST("funnel_event"."occurredAt",EXCLUDED."occurredAt");
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Optional funnel measurement failed (%)', SQLSTATE;
END;
$$;

CREATE FUNCTION funnel_user_created() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM funnel_record(NEW.id,'signup_completed',NEW.id,NEW."createdAt",'{}');
  RETURN NEW;
END;
$$;
CREATE TRIGGER funnel_user_created AFTER INSERT ON "user" FOR EACH ROW EXECUTE FUNCTION funnel_user_created();

CREATE FUNCTION funnel_social_connected() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM funnel_record(NEW."userId",'social_connected',NEW.id,NEW."createdAt",jsonb_build_object('platform',NEW.platform));
  RETURN NEW;
END;
$$;
CREATE TRIGGER funnel_social_connected AFTER INSERT ON connected_account FOR EACH ROW EXECUTE FUNCTION funnel_social_connected();

CREATE FUNCTION funnel_trial_started() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM funnel_record(NEW."userId",'trial_started',NEW.id,NEW."startsAt",jsonb_build_object('durationDays',extract(epoch from (NEW."expiresAt"-NEW."startsAt"))/86400));
  RETURN NEW;
END;
$$;
CREATE TRIGGER funnel_trial_started AFTER INSERT ON free_trial FOR EACH ROW EXECUTE FUNCTION funnel_trial_started();

CREATE FUNCTION funnel_post_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_kind TEXT; event_at TIMESTAMP(3);
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM funnel_record(NEW."userId",'post_created',NEW.id,NEW."createdAt",jsonb_build_object('status',NEW.status));
  END IF;
  IF TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    event_kind := CASE NEW.status WHEN 'scheduled' THEN 'post_scheduled' WHEN 'pending' THEN 'post_dispatch_started' WHEN 'published' THEN 'post_published' WHEN 'failed' THEN 'post_failed' ELSE NULL END;
    IF event_kind IS NOT NULL THEN
      event_at := CASE WHEN NEW.status='published' THEN COALESCE(NEW."publishedAt",NEW."updatedAt") ELSE NEW."updatedAt" END;
      PERFORM funnel_record(NEW."userId",event_kind,NEW.id || ':' || event_at::text,event_at,'{}');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER funnel_post_changed AFTER INSERT OR UPDATE OF status ON post FOR EACH ROW EXECUTE FUNCTION funnel_post_changed();

CREATE FUNCTION funnel_first_payment() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM funnel_record(NEW."userId",'first_payment',NEW."userId",NEW."paidAt",jsonb_build_object('amountPaid',NEW."amountPaid",'currency',NEW.currency));
  RETURN NEW;
END;
$$;
CREATE TRIGGER funnel_first_payment AFTER INSERT OR UPDATE OF "paidAt" ON first_payment FOR EACH ROW EXECUTE FUNCTION funnel_first_payment();

ALTER TABLE activation_milestone
  ADD COLUMN "firstToolCalledAt" TIMESTAMP(3),
  ADD COLUMN "firstToolSucceededAt" TIMESTAMP(3),
  ADD COLUMN "firstPostAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "secondPublishingDayAt" TIMESTAMP(3);
-- Historical repeat use is a retained-row lower bound; never replay it into browser analytics.
UPDATE activation_milestone a SET "secondPublishingDayAt" = (
  SELECT min(p."publishedAt") FROM post p WHERE p."userId"=a."userId" AND p.status='published'
    AND p."publishedAt"::date > a."firstPostPublishedAt"::date
);
UPDATE activation_milestone SET "reportedKinds" = array_append("reportedKinds",'repeat_published')
  WHERE "secondPublishingDayAt" IS NOT NULL;

CREATE FUNCTION funnel_update_milestones() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind='tool_called' THEN
    UPDATE activation_milestone SET "firstToolCalledAt"=LEAST("firstToolCalledAt",NEW."occurredAt") WHERE "userId"=NEW."userId";
  ELSIF NEW.kind='tool_succeeded' THEN
    UPDATE activation_milestone SET "firstToolSucceededAt"=LEAST("firstToolSucceededAt",NEW."occurredAt") WHERE "userId"=NEW."userId";
  ELSIF NEW.kind='post_create_attempted' THEN
    UPDATE activation_milestone SET "firstPostAttemptedAt"=LEAST("firstPostAttemptedAt",NEW."occurredAt") WHERE "userId"=NEW."userId";
  ELSIF NEW.kind='post_published' THEN
    UPDATE activation_milestone a SET "secondPublishingDayAt"=LEAST(a."secondPublishingDayAt",NEW."occurredAt")
      WHERE "userId"=NEW."userId" AND NEW."occurredAt"::date > a."firstPostPublishedAt"::date;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Optional milestone measurement failed (%)', SQLSTATE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER funnel_update_milestones AFTER INSERT ON funnel_event FOR EACH ROW EXECUTE FUNCTION funnel_update_milestones();

ALTER TABLE "user" ADD COLUMN "lastNonDirectAcquisition" TEXT;
ALTER TABLE first_payment ADD COLUMN "attributionSnapshot" TEXT;
-- No guessed attribution backfill: both fields are populated prospectively.
