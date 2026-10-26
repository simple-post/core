import { createPost, previewPost, updateScheduledPost } from "@/lib/mcp/tools/posts";
import { validatePost } from "@/lib/mcp/tools/validation";
import { ingestPostMedia } from "@/lib/media-ingestion";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: { connectedAccount: { findMany: jest.fn(), count: jest.fn() } },
}));
jest.mock("@/lib/media-ingestion", () => ({ ingestPostMedia: jest.fn() }));
jest.mock("@/lib/db", () => ({
  PostsModel: jest.fn(() => ({
    getPostById: async () => ({
      id: "draft-1",
      status: "draft",
      message: "A saved draft",
      accountIds: ["disconnected-account"],
      media: [],
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    }),
  })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(prisma.connectedAccount.findMany).mockResolvedValue([]);
  jest.mocked(prisma.connectedAccount.count).mockResolvedValue(0);
});

const input = {
  message: "Hello",
  accountIds: ["disconnected-account"],
  media: [{ type: "image" as const, url: "https://example.test/photo.jpg" }],
};

it.each([
  ["validate", () => validatePost("user", input)],
  ["preview", () => previewPost("user", { ...input, postingMode: "draft" })],
  ["create", () => createPost("user", { ...input, postingMode: "draft" })],
  ["update", () => updateScheduledPost("user", { postId: "draft-1", message: "Updated", media: input.media })],
] as const)("%s stops before importing media when no social account exists", async (_name, action) => {
  await expect(action()).rejects.toMatchObject({
    code: "NO_CONNECTED_ACCOUNTS",
    message: expect.stringContaining("[Connect a social account]("),
    recovery: "stop",
    maxAutomaticRetries: 0,
  });
  expect(ingestPostMedia).not.toHaveBeenCalled();
});
