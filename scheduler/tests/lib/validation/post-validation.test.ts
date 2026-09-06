import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import type { ConnectedAccount, MediaFile } from "@/types";

import {
  BLUESKY_MAX_IMAGE_SIZE_BYTES,
  BLUESKY_MAX_VIDEO_SIZE_BYTES,
} from "../../../../sdk/src/publishers/bluesky/validation";

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
  it("rejects playlist assignment regardless of granted scopes while allowing ordinary uploads", () => {
    const account = {
      ...blueskyAccount,
      platform: "youtube",
      scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    };
    const params = {
      message: "Video title",
      media: [
        {
          id: "video",
          url: "https://example.com/video.mp4",
          type: "video" as const,
          filename: "video.mp4",
          size: 1024,
        },
      ],
      accounts: [account],
    };
    expect(validatePostForResolvedAccounts(params).summary.isValid).toBe(true);
    const withPlaylist = { ...params, accountOptions: { [account.id]: { playlistId: "PL-test" } } };
    expect(validatePostForResolvedAccounts(withPlaylist).summary.errors).toContainEqual(
      expect.objectContaining({ code: "youtube_playlist_unavailable" }),
    );
    for (const scope of [null, "", account.scope + " https://www.googleapis.com/auth/youtube.force-ssl"]) {
      const result = validatePostForResolvedAccounts({
        ...withPlaylist,
        accounts: [{ ...account, scope }],
      });
      expect(result.summary.isValid).toBe(false);
      expect(result.summary.errors).toContainEqual(expect.objectContaining({ code: "youtube_playlist_unavailable" }));
    }
  });
  it("requires a board for each Pinterest target before dispatch", () => {
    const accounts = [
      { ...blueskyAccount, id: "pin-1", platform: "pinterest" },
      { ...blueskyAccount, id: "pin-2", platform: "pinterest" },
    ];
    const result = validatePostForResolvedAccounts({
      message: "Pin",
      media: [image(1024)],
      accounts,
      accountOptions: { "pin-1": { boardId: "selected-board" }, "pin-2": { boardId: "  " } },
    });
    expect(result.results[0].isValid).toBe(true);
    expect(result.results[1].errors).toContainEqual(
      expect.objectContaining({ code: "pinterest_board_required", meta: { accountId: "pin-2" } }),
    );
  });
  const video: MediaFile = {
    id: "video",
    url: "https://example.com/video.mp4",
    type: "video",
    filename: "video.mp4",
    size: 1024,
    durationSec: 60,
  };

  it("accepts Bluesky video roots, replies and account overrides", () => {
    const result = validatePostForResolvedAccounts({
      message: "",
      media: [video],
      accounts: [blueskyAccount],
      thread: [{ message: "Reply", media: [video] }],
    });
    expect(result.summary.isValid).toBe(true);
    expect(result.results[0].rules.video).toMatchObject({
      maxSizeBytes: BLUESKY_MAX_VIDEO_SIZE_BYTES,
      maxDurationSec: 600,
    });
    expect(
      validatePostForResolvedAccounts({
        message: "",
        media: [],
        accounts: [blueskyAccount],
        accountOverrides: { [blueskyAccount.id]: { media: [video] } },
      }).summary.isValid,
    ).toBe(true);
  });

  it.each([
    [[{ ...video, size: BLUESKY_MAX_VIDEO_SIZE_BYTES + 1 }], "video_too_large"],
    [[{ ...video, durationSec: 601 }], "video_too_long"],
    [[video, video], "too_many_videos"],
    [[video, image(1024)], "mixed_media_not_supported"],
  ])("rejects unsupported Bluesky video input %j", (media, code) => {
    expect(
      validatePostForResolvedAccounts({ message: "Video", media, accounts: [blueskyAccount] }).summary.errors,
    ).toContainEqual(expect.objectContaining({ code }));
  });

  it("validates video duration in replies and overrides", () => {
    const result = validatePostForResolvedAccounts({
      message: "Root",
      media: [],
      accounts: [blueskyAccount],
      accountOverrides: {
        [blueskyAccount.id]: { thread: [{ message: "Reply", media: [{ ...video, durationSec: 601 }] }] },
      },
    });
    expect(result.summary.errors).toContainEqual(
      expect.objectContaining({ code: "video_too_long", field: "thread[0].media[0]" }),
    );
  });
  it("checks cashtags separately for each X thread segment and account override", () => {
    const account = { ...blueskyAccount, id: "x-account", platform: "x" };
    const input = { message: "$BTC", media: [], accounts: [account], thread: [{ message: "$ETH" }] };
    expect(validatePostForResolvedAccounts(input).summary.isValid).toBe(true);
    expect(validatePostForResolvedAccounts({ ...input, thread: [{ message: "$ETH $ETH" }] }).summary.errors).toEqual([
      expect.objectContaining({ code: "too_many_cashtags", field: "thread[0]", meta: { accountId: account.id } }),
    ]);
    expect(
      validatePostForResolvedAccounts({ ...input, accountOverrides: { [account.id]: { message: "$BTC $ETH" } } })
        .summary.errors,
    ).toEqual([expect.objectContaining({ code: "too_many_cashtags", field: "text", meta: { accountId: account.id } })]);
  });
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

it("validates TikTok photos and options consistently for UI, HTTP and MCP", () => {
  const media = Array.from({ length: 7 }, (_, i) => image(1024, String(i)));
  const validate = (options: Record<string, unknown>, count = 7) =>
    validatePostForResolvedAccounts({
      message: "x".repeat(4000),
      media: media.slice(0, count),
      accounts: [tikTokAccount],
      accountOptions: { [tikTokAccount.id]: options },
    });
  expect(
    validate({ privacyLevel: "SELF_ONLY", autoAddMusic: true, title: "Title", photoCoverIndex: 6 }).summary.isValid,
  ).toBe(true);
  expect(validate({ publishMode: "draft" }).summary.isValid).toBe(true);
  expect(validate({ publishMode: "draft", autoAddMusic: true }).summary.errors).toContainEqual(
    expect.objectContaining({ code: "auto_music_unavailable" }),
  );
  expect(validate({ privacyLevel: "SELF_ONLY", photoCoverIndex: 7 }).summary.errors).toContainEqual(
    expect.objectContaining({ code: "photo_cover_invalid" }),
  );
  expect(validate({ privacyLevel: "SELF_ONLY", title: "x".repeat(91) }).summary.isValid).toBe(false);
});
