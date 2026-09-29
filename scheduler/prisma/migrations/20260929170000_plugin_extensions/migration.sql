ALTER TYPE "Feature" ADD VALUE 'PLUGIN_EXTENSIONS';
CREATE TABLE "user_publishing_preferences" (
  "userId" TEXT PRIMARY KEY,
  "timeZone" TEXT,
  "calendarView" TEXT NOT NULL DEFAULT 'week',
  "defaultAccountIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_publishing_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "post_editor_session" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "postId" TEXT,
  "baseUpdatedAt" TIMESTAMP(3),
  "payload" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "proposal" JSONB,
  "committing" BOOLEAN NOT NULL DEFAULT false,
  "commitRevision" INTEGER,
  "commitMode" TEXT,
  "commitResult" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "post_editor_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "post_editor_session_userId_expiresAt_idx" ON "post_editor_session"("userId", "expiresAt");
