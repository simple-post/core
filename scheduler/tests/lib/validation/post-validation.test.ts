import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import type { ConnectedAccount, MediaFile } from "@/types";

import { BLUESKY_MAX_IMAGE_SIZE_BYTES } from "../../../../sdk/src/publishers/bluesky/validation";

const blueskyAccount: ConnectedAccount = {
  id: "bluesky-account",
  userId: "user",
  platform: "bluesky",
  platformAccountId: "did:plc:test",
  accessToken: "token",
  refreshToken: null,
  tokenType: null,
  expiresAt: null,
  scope: null,
  username: "test.bsky.social",
  displayName: "Test",
  email: null,
  profilePicture: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const tikTokAccount: ConnectedAccount = {
  ...blueskyAccount,
  id: "tiktok-account",
  platform: "tiktok",
  platformAccountId: "tiktok-user",
  username: "test.tiktok",
};

function image(size: number, id = "image"): MediaFile {
  return {
    id,
    url: `https://example.com/${id}.jpg`,
    type: "image",
    filename: `${id}.jpg`,
    size,
  };
}

describe("post validation", () => {
  it("rejects an oversized Bluesky image using uploaded media metadata", () => {
    const result = validatePostForResolvedAccounts({
      message: "Oversized image",
      media: [image(BLUESKY_MAX_IMAGE_SIZE_BYTES + 62_904)],
      accounts: [blueskyAccount],
    });

    expect(result.summary).toMatchObject({
      isValid: false,
      errors: [
        {
          platform: "bluesky",
          code: "image_too_large",
          field: "text.media[0]",
          limit: BLUESKY_MAX_IMAGE_SIZE_BYTES,
          actual: BLUESKY_MAX_IMAGE_SIZE_BYTES + 62_904,
          meta: { accountId: blueskyAccount.id },
        },
      ],
    });
  });

  it("validates oversized images in Bluesky thread segments", () => {
    const result = validatePostForResolvedAccounts({
      message: "Root",
      media: [],
      accounts: [blueskyAccount],
      thread: [{ message: "Reply", media: [image(BLUESKY_MAX_IMAGE_SIZE_BYTES + 1, "thread-image")] }],
    });

    expect(result.summary.errors).toEqual([
      expect.objectContaining({
        code: "image_too_large",
        field: "thread[0].media[0]",
        actual: BLUESKY_MAX_IMAGE_SIZE_BYTES + 1,
      }),
    ]);
  });

  it("rejects TikTok posts without a selected privacy status before publishing", () => {
    const result = validatePostForResolvedAccounts({
      message: "TikTok post",
      media: [image(100, "tiktok-image")],
      accounts: [tikTokAccount],
    });

    expect(result.summary.errors).toContainEqual(
      expect.objectContaining({
        platform: "tiktok",
        code: "tiktok_privacy_status_required",
        field: "accountOptions.privacyLevel",
        meta: { accountId: tikTokAccount.id },
      }),
    );
    expect(result.summary.isValid).toBe(false);
  });

  it("accepts configured TikTok privacy and skips publishing-only checks for drafts", () => {
    const configured = validatePostForResolvedAccounts({
      message: "TikTok post",
      media: [image(100, "configured-tiktok-image")],
      accounts: [tikTokAccount],
      accountOptions: {
        [tikTokAccount.id]: { privacyLevel: "PUBLIC_TO_EVERYONE" },
      },
    });
    const draft = validatePostForResolvedAccounts({
      message: "TikTok draft",
      media: [image(100, "draft-tiktok-image")],
      accounts: [tikTokAccount],
      accountOptions: {
        [tikTokAccount.id]: { publishMode: "draft" },
      },
    });

    expect(configured.summary.errors).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "tiktok_privacy_status_required" })]),
    );
    expect(draft.summary.errors).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "tiktok_privacy_status_required" })]),
    );
  });
});
