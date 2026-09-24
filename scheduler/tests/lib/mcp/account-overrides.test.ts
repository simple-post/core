import { assertCanCreatePost } from "@/lib/billing/subscriptions";
import { PostsModel } from "@/lib/db";
import { createPost, createPostSchema, updateScheduledPost, updateScheduledPostSchema } from "@/lib/mcp/tools/posts";
import { validatePost, validatePostSchema } from "@/lib/mcp/tools/validation";
import { ingestPostMedia } from "@/lib/media-ingestion";
import { postToAccounts } from "@/lib/posting";
import { prisma } from "@/lib/prisma";
import { deleteMediaFiles } from "@/lib/utils/media-cleanup";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";

jest.mock("@/lib/features", () => ({ hasFeature: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/db", () => ({ PostsModel: jest.fn() }));
jest.mock("@/lib/media-ingestion", () => ({
  ingestPostMedia: jest.fn(async (_userId, input) => input),
}));
jest.mock("@/lib/prisma", () => ({ prisma: { $transaction: jest.fn(), connectedAccount: { findMany: jest.fn() } } }));
jest.mock("@/lib/mcp/tools/accounts", () => ({
  ...jest.requireActual("@/lib/mcp/tools/accounts"),
  listAccounts: jest.fn().mockResolvedValue({ accounts: [] }),
}));
jest.mock("@/lib/billing/subscriptions", () => ({
  assertCanCreatePost: jest.fn(),
  getBillingStatus: jest.fn().mockResolvedValue({ accessType: "stripe", trial: null }),
  lockUserForQuota: jest.fn(),
  toBillingSocialAccounts: jest.fn(),
}));
jest.mock("@/lib/oauth/credential-health", () => ({
  getCredentialIssuesForPublishTime: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/quote/source", () => ({ validateQuoteSource: jest.fn(), assertNoUnresolvedQuotes: jest.fn() }));
jest.mock("@/lib/repost/settings", () => ({
  resolvePostRepostSettings: jest.fn().mockResolvedValue({ enabled: false, delayHours: 12 }),
  buildPublishedRepostState: jest.fn().mockReturnValue({ repostStatus: "not_applicable", repostDueAt: null }),
}));
jest.mock("@/lib/validation/sdk-validation", () => ({ validatePostForAccounts: jest.fn() }));
jest.mock("@/lib/webhooks", () => ({ dispatchPostWebhooks: jest.fn() }));
jest.mock("@/lib/utils/media-cleanup", () => ({ deleteMediaFiles: jest.fn() }));
jest.mock("@/lib/posting", () => ({
  postToAccounts: jest.fn().mockResolvedValue([{ accountId: "x-1", platform: "x", success: true }]),
  getPostingSummary: jest.fn().mockReturnValue({ overallSuccess: true, successCount: 1, failureCount: 0 }),
}));

const savePost = jest.fn();
const loadPost = jest.fn();
const updatePost = jest.fn();
const ACCOUNTS = [
  { id: "x-1", platform: "x" },
  { id: "linkedin-1", platform: "linkedin" },
  { id: "bluesky-1", platform: "bluesky" },
  { id: "threads-1", platform: "threads" },
];
function validResult(accountIds: string[]) {
  const accounts = ACCOUNTS.filter((account) => accountIds.includes(account.id));
  return {
    accounts,
    platforms: accounts.map((account) => account.platform),
    results: accounts.map((account) => ({
      accountId: account.id,
      platform: account.platform,
      isValid: true,
      errors: [],
      warnings: [],
    })),
    summary: { isValid: true, errors: [], warnings: [] },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (ingestPostMedia as jest.Mock).mockImplementation(async (_userId, input) => input);
  (PostsModel as jest.Mock).mockImplementation(() => ({
    createPost: savePost,
    updatePost,
    getPostById: loadPost,
  }));
  loadPost.mockReset();
  updatePost.mockReset();
  (prisma.connectedAccount.findMany as jest.Mock).mockImplementation(async ({ where }) =>
    ACCOUNTS.filter((account) => where.id.in.includes(account.id)),
  );
  savePost.mockImplementation(async (post) => ({ ...post, id: "post-1" }));
  (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => callback({}));
  (validatePostForAccounts as jest.Mock).mockImplementation(async ({ accountIds }) => validResult(accountIds));
});

const longForm = "A long post for X and LinkedIn. ".repeat(20);
const blueskyThread = {
  message: "Part 1 for Bluesky",
  thread: [{ message: "Part 2" }, { message: "Part 3" }],
};

it.each(["now", "schedule", "draft"] as const)(
  "keeps a long post and per-account threads in one %s post",
  async (postingMode) => {
    await createPost(
      "user-1",
      createPostSchema.parse({
        message: longForm,
        accountIds: ["x-1", "linkedin-1", "bluesky-1", "threads-1"],
        accountOverrides: { "bluesky-1": blueskyThread, "threads-1": blueskyThread },
        postingMode,
        ...(postingMode === "schedule" ? { scheduledFor: "2099-01-01T10:00:00Z" } : {}),
      }),
    );

    const expectedOverrides = {
      "bluesky-1": { message: "Part 1 for Bluesky", thread: [{ message: "Part 2" }, { message: "Part 3" }] },
      "threads-1": { message: "Part 1 for Bluesky", thread: [{ message: "Part 2" }, { message: "Part 3" }] },
    };
    expect(savePost).toHaveBeenCalledTimes(1);
    expect(savePost).toHaveBeenCalledWith(
      expect.objectContaining({ message: longForm, thread: undefined, accountOverrides: expectedOverrides }),
      "user-1",
      {},
    );
    expect(validatePostForAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ accountOverrides: expectedOverrides }),
    );
    // The trial thread limit counts the longest thread any account publishes.
    expect(assertCanCreatePost).toHaveBeenCalledWith("user-1", {}, expect.objectContaining({ threadSegments: 3 }));
    if (postingMode === "now") {
      expect((postToAccounts as jest.Mock).mock.calls[0][5]).toEqual(expectedOverrides);
    } else {
      expect(postToAccounts).not.toHaveBeenCalled();
    }
  },
);

it("keeps an omitted override field distinct from an empty one", async () => {
  await createPost(
    "user-1",
    createPostSchema.parse({
      message: "Shared",
      accountIds: ["x-1", "bluesky-1"],
      thread: [{ message: "Shared reply" }],
      accountOverrides: { "x-1": { thread: [] }, "bluesky-1": { message: "Only the text changes" } },
      postingMode: "draft",
    }),
  );

  const [saved] = savePost.mock.calls[0];
  expect(saved.accountOverrides).toEqual({
    "x-1": { thread: [] },
    "bluesky-1": { message: "Only the text changes" },
  });
  expect(saved.accountOverrides["bluesky-1"]).not.toHaveProperty("thread");
  expect(saved.accountOverrides["bluesky-1"]).not.toHaveProperty("media");
});

it("rejects overrides for accounts the post does not target", async () => {
  await expect(
    createPost(
      "user-1",
      createPostSchema.parse({
        message: "Shared",
        accountIds: ["x-1"],
        accountOverrides: { "bluesky-1": blueskyThread },
        postingMode: "draft",
      }),
    ),
  ).rejects.toThrow("bluesky-1");
  expect(savePost).not.toHaveBeenCalled();
});

it("passes per-account threads to validate_post", async () => {
  await validatePost(
    "user-1",
    validatePostSchema.parse({
      message: longForm,
      accountIds: ["x-1", "bluesky-1"],
      accountOverrides: { "bluesky-1": blueskyThread },
    }),
  );

  expect(validatePostForAccounts).toHaveBeenCalledWith(
    expect.objectContaining({
      accountOverrides: {
        "bluesky-1": { message: "Part 1 for Bluesky", thread: [{ message: "Part 2" }, { message: "Part 3" }] },
      },
    }),
  );
});

describe("update_scheduled_post", () => {
  const segmentMedia = [
    { id: "seg", type: "image" as const, url: "https://example.com/seg.jpg", filename: "seg.jpg", size: 1 },
  ];
  const basePost = {
    id: "post-1",
    message: longForm,
    status: "draft",
    accountIds: ["x-1", "bluesky-1"],
    accountOptions: undefined,
    media: [],
    thread: [],
    accountOverrides: {
      "bluesky-1": { message: "Part 1", thread: [{ message: "Part 2", media: segmentMedia }] },
    },
    createdAt: new Date(),
    updatedAt: new Date("2026-09-05T00:00:00Z"),
    scheduledFor: null,
  };

  beforeEach(() => {
    loadPost.mockResolvedValue(basePost);
    updatePost.mockImplementation(async (_id: string, updates: Record<string, unknown>) => ({
      ...basePost,
      ...updates,
    }));
  });

  it("keeps segment media when an account thread is replaced with text-only segments", async () => {
    const result = await updateScheduledPost(
      "user-1",
      updateScheduledPostSchema.parse({
        postId: "post-1",
        accountOverrides: { "bluesky-1": { message: "Part 1", thread: [{ message: "Edited part 2" }] } },
      }),
    );

    const [, updates] = updatePost.mock.calls[0];
    expect(updates.accountOverrides).toEqual({
      "bluesky-1": { message: "Part 1", thread: [{ message: "Edited part 2", media: segmentMedia }] },
    });
    expect(deleteMediaFiles).not.toHaveBeenCalled();
    expect(result.summary.accountOverridesChanged).toBe(true);
    expect(result.post.accountOverrides["bluesky-1"].thread?.[0].message).toBe("Edited part 2");
  });

  it("clears overrides with null and releases their media", async () => {
    await updateScheduledPost("user-1", updateScheduledPostSchema.parse({ postId: "post-1", accountOverrides: null }));

    const [, updates] = updatePost.mock.calls[0];
    expect(updates.accountOverrides).toEqual({});
    expect(deleteMediaFiles).toHaveBeenCalledWith("user-1", [expect.objectContaining({ id: "seg" })]);
  });

  it("does not delete override media when only the shared content changes", async () => {
    await updateScheduledPost("user-1", updateScheduledPostSchema.parse({ postId: "post-1", message: "New root" }));

    const [, updates] = updatePost.mock.calls[0];
    expect(updates.accountOverrides).toEqual(basePost.accountOverrides);
    expect(deleteMediaFiles).not.toHaveBeenCalled();
  });
});
