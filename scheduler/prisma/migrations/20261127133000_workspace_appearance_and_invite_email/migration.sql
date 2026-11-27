ALTER TABLE "user"
  ADD COLUMN "personalWorkspaceLogo" TEXT,
  ALTER COLUMN "personalWorkspaceName" SET DEFAULT 'Personal Workspace',
  ALTER COLUMN "personalWorkspaceColor" SET DEFAULT 'none';

UPDATE "user" SET "personalWorkspaceColor" = 'none'
  WHERE "personalWorkspaceName" = 'Personal' AND "personalWorkspaceColor" = 'slate';
UPDATE "user" SET "personalWorkspaceName" = 'Personal Workspace'
  WHERE "personalWorkspaceName" = 'Personal';

ALTER TABLE "TeamWorkspace" ADD COLUMN "logo" TEXT;
ALTER TABLE "TeamInvite" ADD COLUMN "emailSentAt" TIMESTAMP(3);
