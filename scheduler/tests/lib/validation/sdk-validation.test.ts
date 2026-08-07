import { hydrateRemoteMediaSizesForAccounts } from "@simple-post/sdk";

import { prisma } from "@/lib/prisma";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";

jest.mock("@simple-post/sdk", () => ({
  ...jest.requireActual("@simple-post/sdk"),
  hydrateRemoteMediaSizesForAccounts: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    connectedAccount: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/config", () => ({
  getPlatformById: (platform: string) => ({ id: platform, name: "X (Twitter)" }),
  isSocialPlatformEnabled: () => true,
}));

const prismaMock = prisma as unknown as {
  connectedAccount: {
    findMany: jest.Mock;
  };
};
const hydrateRemoteMediaSizesMock = hydrateRemoteMediaSizesForAccounts as jest.MockedFunction<
  typeof hydrateRemoteMediaSizesForAccounts
>;

const connectedAccount = {
  id: "account-1",
  userId: "user-1",
  platform: "x",
  platformAccountId: "x-1",
  accessToken: "encrypted-access-token",
  refreshToken: "encrypted-refresh-token",
  tokenMetadata: { previewOnly: true },
  credentialRefreshRetryAt: null,
  credentialRefreshBlockedAt: null,
  tokenType: "Bearer",
  expiresAt: null,
  scope: null,
  username: "preview",
  displayName: "Preview Account",
  email: null,
  profilePicture: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

beforeEach(() => {
  jest.clearAllMocks();
  hydrateRemoteMediaSizesMock.mockResolvedValue([]);
});

it("marks preview-only accounts as unpublishable and strips credentials from validation output", async () => {
  prismaMock.connectedAccount.findMany.mockResolvedValue([connectedAccount]);

  const result = await validatePostForAccounts({
    userId: "user-1",
    message: "Hello",
    media: [],
    accountIds: ["account-1"],
  });

  expect(result.summary.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "preview_only_account", meta: { accountId: "account-1" } }),
    ]),
  );
  expect(result.accounts[0]).toMatchObject({
    id: "account-1",
    accessToken: "",
    refreshToken: null,
    previewOnly: true,
  });
});

it("passes shared, override, thread, and account-option media to the SDK boundary", async () => {
  prismaMock.connectedAccount.findMany.mockResolvedValue([
    { ...connectedAccount, platform: "youtube", tokenMetadata: { previewOnly: false } },
  ]);
  const media = [
    {
      id: "media-1",
      url: "https://cdn.example.com/video.mp4",
      type: "video" as const,
      filename: "video.mp4",
      size: 0,
    },
  ];
  const accountOptions = { "account-1": { thumbnailUrl: "https://cdn.example.com/thumbnail.png" } };
  const accountOverrides = { "account-1": { message: "Override", media } };
  const thread = [{ message: "Reply" }];

  await validatePostForAccounts({
    userId: "user-1",
    message: "Hello",
    media,
    accountIds: ["account-1"],
    accountOptions,
    accountOverrides,
    thread,
  });

  expect(hydrateRemoteMediaSizesMock).toHaveBeenCalledWith({
    media,
    accounts: [expect.objectContaining({ id: "account-1", platform: "youtube", accessToken: "" })],
    accountOptions,
    accountOverrides,
    thread,
  });
});

it("validates and persists the measured size returned through the SDK boundary", async () => {
  prismaMock.connectedAccount.findMany.mockResolvedValue([
    { ...connectedAccount, platform: "x", tokenMetadata: { previewOnly: false } },
  ]);
  const media = [
    {
      id: "media-1",
      url: "https://cdn.example.com/generated-image.png",
      type: "image" as const,
      filename: "generated-image.png",
      size: 0,
    },
  ];
  hydrateRemoteMediaSizesMock.mockImplementation(async ({ media: inspectedMedia }) => {
    inspectedMedia[0].size = 5_506_166;
    return [];
  });

  const result = await validatePostForAccounts({
    userId: "user-1",
    message: "Hello",
    media,
    accountIds: ["account-1"],
  });

  expect(media[0].size).toBe(5_506_166);
  expect(result.summary.errors).toContainEqual(
    expect.objectContaining({ platform: "x", code: "image_too_large", actual: 5_506_166 }),
  );
});

it("merges SDK media inspection failures into account and summary validation", async () => {
  prismaMock.connectedAccount.findMany.mockResolvedValue([
    { ...connectedAccount, platform: "x", tokenMetadata: { previewOnly: false } },
  ]);
  hydrateRemoteMediaSizesMock.mockResolvedValue([
    {
      platform: "x",
      severity: "error",
      code: "media_size_unavailable",
      message: "Size unavailable",
      field: "text.media[0]",
      meta: { accountId: "account-1" },
    },
  ]);

  const result = await validatePostForAccounts({
    userId: "user-1",
    message: "Hello",
    media: [],
    accountIds: ["account-1"],
  });

  expect(result.summary.isValid).toBe(false);
  expect(result.results[0]).toMatchObject({ isValid: false });
  expect(result.results[0].errors).toContainEqual(expect.objectContaining({ code: "media_size_unavailable" }));
  expect(result.summary.errors).toContainEqual(expect.objectContaining({ code: "media_size_unavailable" }));
});
