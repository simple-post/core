ALTER TABLE "user" ADD COLUMN "personalWorkspaceName" TEXT NOT NULL DEFAULT 'Personal';
ALTER TABLE "user" ADD COLUMN "personalWorkspaceColor" TEXT NOT NULL DEFAULT 'slate';
ALTER TABLE "TeamWorkspace" ADD COLUMN "color" TEXT NOT NULL DEFAULT 'indigo';
ALTER TABLE "connected_account" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "connected_account" ADD CONSTRAINT "connected_account_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "TeamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "connected_account_userId_platform_platformAccountId_key";
CREATE UNIQUE INDEX "connected_account_personal_identity_idx"
  ON "connected_account" ("userId", "platform", "platformAccountId") WHERE "workspaceId" IS NULL;
CREATE UNIQUE INDEX "connected_account_workspace_identity_idx"
  ON "connected_account" ("workspaceId", "platform", "platformAccountId") WHERE "workspaceId" IS NOT NULL;
CREATE INDEX "connected_account_workspaceId_idx" ON "connected_account" ("workspaceId");
ALTER TABLE "social_activity_sync" ADD COLUMN "lastErrorCode" TEXT;
