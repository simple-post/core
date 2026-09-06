import { getPlatformOAuthConfig } from "@/lib/oauth/config";

test("YouTube connections request only the existing upload, read and profile permissions", () => {
  expect(getPlatformOAuthConfig("youtube")?.scope.split(/\s+/).sort()).toEqual([
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.upload",
  ]);
});
