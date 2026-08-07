import fs, { type Stats } from "node:fs";

import { downloadToTempFile } from "@simple-post/sdk";

import { prisma } from "@/lib/prisma";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";

jest.mock("node:fs");

jest.mock("@simple-post/sdk", () => ({
  ...jest.requireActual("@simple-post/sdk"),
  downloadToTempFile: jest.fn(),
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
const downloadToTempFileMock = downloadToTempFile as jest.MockedFunction<typeof downloadToTempFile>;
const fsMock = fs as jest.Mocked<typeof fs>;

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
  downloadToTempFileMock.mockResolvedValue("/tmp/telegram-media.png");
  fsMock.statSync.mockReturnValue({ size: 1024 } as Stats);
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

it("measures unknown Telegram URL media before validation and persists the measured size", async () => {
  prismaMock.connectedAccount.findMany.mockResolvedValue([
    { ...connectedAccount, platform: "telegram", tokenMetadata: { previewOnly: false } },
  ]);
  fsMock.statSync.mockReturnValue({ size: 5_506_166 } as Stats);
  const media = [
    {
      id: "media-1",
      url: "https://cdn.example.com/generated-image.png",
      type: "image" as const,
      filename: "generated-image.png",
      size: 0,
    },
  ];

  const result = await validatePostForAccounts({
    userId: "user-1",
    message: "Hello",
    media,
    accountIds: ["account-1"],
  });

  expect(downloadToTempFileMock).toHaveBeenCalledWith(media[0].url, undefined, 10 * 1024 * 1024);
  expect(fsMock.unlinkSync).toHaveBeenCalledWith("/tmp/telegram-media.png");
  expect(media[0].size).toBe(5_506_166);
  expect(result.summary.errors.filter((issue) => issue.code === "image_too_large")).toHaveLength(0);
});

it("rejects unknown Telegram URL media before scheduling when it exceeds the multipart limit", async () => {
  prismaMock.connectedAccount.findMany.mockResolvedValue([
    { ...connectedAccount, platform: "telegram", tokenMetadata: { previewOnly: false } },
  ]);
  downloadToTempFileMock.mockRejectedValue(new Error("Media exceeds the maximum download size of 10485760 bytes"));
  const media = [
    {
      id: "media-1",
      url: "https://cdn.example.com/oversized.png",
      type: "image" as const,
      filename: "oversized.png",
      size: 0,
    },
  ];

  const result = await validatePostForAccounts({
    userId: "user-1",
    message: "Hello",
    media,
    accountIds: ["account-1"],
  });

  expect(media[0].size).toBe(10 * 1024 * 1024 + 1);
  expect(result.summary.errors).toContainEqual(
    expect.objectContaining({
      platform: "telegram",
      code: "image_too_large",
      limit: 10 * 1024 * 1024,
      actual: 10 * 1024 * 1024 + 1,
    }),
  );
});
