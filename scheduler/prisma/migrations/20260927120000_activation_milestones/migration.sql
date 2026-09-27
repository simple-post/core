-- First-time activation milestones for accounts created with acquisition tracking.
-- Database triggers record them for every interface (web app, MCP, CLI, API and the
-- scheduled dispatcher). Each timestamp keeps the earliest value and never moves later.
CREATE TABLE "activation_milestone" (
    "userId" TEXT NOT NULL,
    "signupCompletedAt" TIMESTAMP(3),
    "aiConnectedAt" TIMESTAMP(3),
    "aiClient" TEXT,
    "socialConnectedAt" TIMESTAMP(3),
    "socialPlatform" TEXT,
    "firstPostCreatedAt" TIMESTAMP(3),
    "firstPostScheduledAt" TIMESTAMP(3),
    "firstPostPublishedAt" TIMESTAMP(3),
    "subscriptionStartedAt" TIMESTAMP(3),
    "reportedKinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "activation_milestone_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "activation_milestone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "activation_milestone_signupCompletedAt_idx" ON "activation_milestone"("signupCompletedAt");

-- Record one milestone. Rows exist only for tracked accounts: created at signup or by
-- the backfill below. Untracked (legacy or self-hosted) accounts are ignored, so a
-- later action by an existing customer is never counted as a "first".
CREATE FUNCTION activation_record(p_user TEXT, p_kind TEXT, p_at TIMESTAMP(3), p_detail TEXT)
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
    UPDATE "activation_milestone" SET "firstPostPublishedAt" = p_at, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = p_user AND ("firstPostPublishedAt" IS NULL OR "firstPostPublishedAt" > p_at);
  ELSIF p_kind = 'subscription_started' THEN
    UPDATE "activation_milestone" SET "subscriptionStartedAt" = p_at, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = p_user AND ("subscriptionStartedAt" IS NULL OR "subscriptionStartedAt" > p_at);
  END IF;
END;
$$;

CREATE FUNCTION activation_user_created() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."acquisition" IS NOT NULL THEN
    INSERT INTO "activation_milestone" ("userId", "signupCompletedAt") VALUES (NEW."id", NEW."createdAt")
      ON CONFLICT ("userId") DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "activation_user_created" AFTER INSERT ON "user"
  FOR EACH ROW EXECUTE FUNCTION activation_user_created();

CREATE FUNCTION activation_social_connected() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM activation_record(NEW."userId", 'social_connected', NEW."createdAt", NEW."platform");
  RETURN NEW;
END;
$$;
CREATE TRIGGER "activation_social_connected" AFTER INSERT ON "connected_account"
  FOR EACH ROW EXECUTE FUNCTION activation_social_connected();

CREATE FUNCTION activation_mcp_connected() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM activation_record(NEW."userId", 'ai_connected', NEW."createdAt",
    COALESCE((SELECT "name" FROM "mcp_oauth_client" WHERE "clientId" = NEW."clientId"), 'MCP Client'));
  RETURN NEW;
END;
$$;
CREATE TRIGGER "activation_mcp_connected" AFTER INSERT ON "mcp_access_token"
  FOR EACH ROW EXECUTE FUNCTION activation_mcp_connected();

CREATE FUNCTION activation_cli_connected() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM activation_record(NEW."userId", 'ai_connected', NEW."createdAt", 'SimplePost CLI');
  RETURN NEW;
END;
$$;
CREATE TRIGGER "activation_cli_connected" AFTER INSERT ON "cli_token"
  FOR EACH ROW EXECUTE FUNCTION activation_cli_connected();

CREATE FUNCTION activation_api_connected() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM activation_record(NEW."userId", 'ai_connected', NEW."createdAt", 'SimplePost API');
  RETURN NEW;
END;
$$;
CREATE TRIGGER "activation_api_connected" AFTER INSERT ON "api_key"
  FOR EACH ROW EXECUTE FUNCTION activation_api_connected();

CREATE FUNCTION activation_post_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM activation_record(NEW."userId", 'post_created', NEW."createdAt", NULL);
  END IF;
  IF NEW."status" = 'scheduled' AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'scheduled') THEN
    PERFORM activation_record(NEW."userId", 'post_scheduled', CURRENT_TIMESTAMP::TIMESTAMP(3), NULL);
  END IF;
  IF NEW."status" = 'published' AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'published') THEN
    PERFORM activation_record(NEW."userId", 'post_published', COALESCE(NEW."publishedAt", CURRENT_TIMESTAMP::TIMESTAMP(3)), NULL);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "activation_post_changed" AFTER INSERT OR UPDATE OF "status" ON "post"
  FOR EACH ROW EXECUTE FUNCTION activation_post_changed();

CREATE FUNCTION activation_first_payment() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM activation_record(NEW."userId", 'subscription_started', NEW."paidAt", NULL);
  RETURN NEW;
END;
$$;
CREATE TRIGGER "activation_first_payment" AFTER INSERT OR UPDATE OF "paidAt" ON "first_payment"
  FOR EACH ROW EXECUTE FUNCTION activation_first_payment();

-- Backfill accounts that already carry acquisition data. Historical milestones are
-- marked as reported so they are never relayed to Plausible as new conversions.
-- "Scheduled" is approximated from posts that carry a future-dated schedule.
INSERT INTO "activation_milestone" (
  "userId", "signupCompletedAt", "aiConnectedAt", "aiClient", "socialConnectedAt", "socialPlatform",
  "firstPostCreatedAt", "firstPostScheduledAt", "firstPostPublishedAt", "subscriptionStartedAt", "reportedKinds"
)
SELECT
  u."id",
  u."createdAt",
  ai."at",
  ai."client",
  sa."createdAt",
  sa."platform",
  (SELECT min(p."createdAt") FROM "post" p WHERE p."userId" = u."id"),
  (SELECT min(p."createdAt") FROM "post" p WHERE p."userId" = u."id" AND p."scheduledFor" IS NOT NULL AND p."scheduledFor" > p."createdAt"),
  (SELECT min(p."publishedAt") FROM "post" p WHERE p."userId" = u."id" AND p."status" = 'published'),
  fp."paidAt",
  ARRAY['signup_completed', 'ai_connected', 'social_connected', 'post_created', 'post_scheduled', 'post_published', 'subscription_started']
FROM "user" u
LEFT JOIN LATERAL (
  SELECT "createdAt", "platform" FROM "connected_account" c WHERE c."userId" = u."id" ORDER BY "createdAt" LIMIT 1
) sa ON TRUE
LEFT JOIN LATERAL (
  SELECT t."at", t."client" FROM (
    SELECT m."createdAt" AS "at", COALESCE(o."name", 'MCP Client') AS "client" FROM "mcp_access_token" m
      LEFT JOIN "mcp_oauth_client" o ON o."clientId" = m."clientId" WHERE m."userId" = u."id"
    UNION ALL SELECT "createdAt", 'SimplePost CLI' FROM "cli_token" WHERE "userId" = u."id"
    UNION ALL SELECT "createdAt", 'SimplePost API' FROM "api_key" WHERE "userId" = u."id"
  ) t ORDER BY t."at" LIMIT 1
) ai ON TRUE
LEFT JOIN "first_payment" fp ON fp."userId" = u."id"
WHERE u."acquisition" IS NOT NULL
ON CONFLICT ("userId") DO NOTHING;
