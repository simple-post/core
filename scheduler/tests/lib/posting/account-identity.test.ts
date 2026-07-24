import { getPlatformAccountHandle } from "@/lib/posting/account-identity";

describe("posting account identity", () => {
  it.each([
    ["x", "x_user"],
    ["instagram", "instagram.user"],
    ["facebook", "facebook.user"],
    ["tiktok", "tiktok_user"],
    ["bluesky", "user.bsky.social"],
    ["threads", "threads_user"],
    ["youtube", "youtube_handle"],
    ["telegram", "telegram_channel"],
    ["pinterest", "pinterest_user"],
    ["forem", "dev_user"],
  ])("normalizes the %s username as a handle", (platform, username) => {
    expect(getPlatformAccountHandle(platform, username)).toBe(`@${username}`);
    expect(getPlatformAccountHandle(platform, `@${username}`)).toBe(`@${username}`);
  });

  it("does not mislabel LinkedIn's stored email as a handle", () => {
    expect(getPlatformAccountHandle("linkedin", "person@example.com")).toBeUndefined();
  });

  it("returns no handle when the provider did not supply a username", () => {
    expect(getPlatformAccountHandle("facebook", null)).toBeUndefined();
  });
});
