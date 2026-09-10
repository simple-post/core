CREATE TYPE "Feature" AS ENUM ('IMAGE_FITTING');

CREATE TABLE "user_feature" (
    "userId" TEXT NOT NULL,
    "feature" "Feature" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_feature_pkey" PRIMARY KEY ("userId", "feature")
);

ALTER TABLE "user_feature" ADD CONSTRAINT "user_feature_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
