import { getPlatformOAuthConfig } from "@/lib/oauth/config";

test("YouTube connections request only channel read and upload permissions", () => {
  expect(getPlatformOAuthConfig("youtube")?.scope.split(/\s+/).sort()).toEqual([
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.upload",
  ]);
});
