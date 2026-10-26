import { getAccountPlatformConfig } from "../../src/lib/account/platforms.js";

test("YouTube CLI OAuth requests only channel read and upload permissions", () => {
  expect([...(getAccountPlatformConfig("youtube").oauthApp?.scopes ?? [])].sort()).toEqual([
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.upload",
  ]);
});
