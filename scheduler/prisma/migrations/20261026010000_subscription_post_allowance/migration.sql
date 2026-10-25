ALTER TABLE "user_subscription"
ADD COLUMN "postsPerMonthOverride" INTEGER,
ADD CONSTRAINT "user_subscription_posts_per_month_override_positive"
CHECK ("postsPerMonthOverride" > 0);
