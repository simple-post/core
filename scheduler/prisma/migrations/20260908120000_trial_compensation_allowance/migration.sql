ALTER TABLE "free_trial"
ADD COLUMN "bonusPostsPerPlatform" INTEGER NOT NULL DEFAULT 0
CHECK ("bonusPostsPerPlatform" >= 0);
