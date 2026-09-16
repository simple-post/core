import { getPlatformOAuthConfig } from "@/lib/oauth/config";

test("YouTube activity scope is opt-in so baseline publishing consent remains usable", () => {
  const previous = process.env.SOCIAL_ACTIVITY_OAUTH_SCOPES;
  delete process.env.SOCIAL_ACTIVITY_OAUTH_SCOPES;
  expect(getPlatformOAuthConfig("youtube")?.scope.split(/\s+/).sort()).toEqual([
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.upload",
  ]);
  process.env.SOCIAL_ACTIVITY_OAUTH_SCOPES = "true";
  expect(getPlatformOAuthConfig("youtube")?.scope).toContain("https://www.googleapis.com/auth/youtube.force-ssl");
  if (previous === undefined) delete process.env.SOCIAL_ACTIVITY_OAUTH_SCOPES;
  else process.env.SOCIAL_ACTIVITY_OAUTH_SCOPES = previous;
});

test("LinkedIn feed scopes stay separately opt-in from member analytics", () => {
  const previousPlatforms = process.env.SOCIAL_ACTIVITY_OAUTH_PLATFORMS;
  const previousComments = process.env.SOCIAL_ACTIVITY_LINKEDIN_COMMENTS;
  process.env.SOCIAL_ACTIVITY_OAUTH_PLATFORMS = "linkedin";
  delete process.env.SOCIAL_ACTIVITY_LINKEDIN_COMMENTS;
  expect(getPlatformOAuthConfig("linkedin")?.scope).toContain("r_member_postAnalytics");
  expect(getPlatformOAuthConfig("linkedin")?.scope).not.toContain("r_member_social_feed");
  process.env.SOCIAL_ACTIVITY_LINKEDIN_COMMENTS = "true";
  expect(getPlatformOAuthConfig("linkedin")?.scope).toContain("r_member_social_feed");
  if (previousPlatforms === undefined) delete process.env.SOCIAL_ACTIVITY_OAUTH_PLATFORMS;
  else process.env.SOCIAL_ACTIVITY_OAUTH_PLATFORMS = previousPlatforms;
  if (previousComments === undefined) delete process.env.SOCIAL_ACTIVITY_LINKEDIN_COMMENTS;
  else process.env.SOCIAL_ACTIVITY_LINKEDIN_COMMENTS = previousComments;
});
