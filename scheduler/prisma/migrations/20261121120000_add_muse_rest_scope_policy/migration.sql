-- Opt-in enforcement for newly authorized Personal Muse grants only.
-- Existing codes and tokens keep their original REST authentication behavior.
ALTER TABLE "mcp_authorization_code" ADD COLUMN "enforceRestScopes" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "mcp_access_token" ADD COLUMN "enforceRestScopes" BOOLEAN NOT NULL DEFAULT false;
