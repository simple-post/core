import { PostsModel } from "@/lib/db";
import {
  createPost,
  createPostSchema,
  previewPost,
  previewPostSchema,
  updateScheduledPost,
  updateScheduledPostSchema,
} from "@/lib/mcp/tools/posts";
import { validatePost, validatePostSchema } from "@/lib/mcp/tools/validation";
import { postToAccounts } from "@/lib/posting";
import { prisma } from "@/lib/prisma";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";

jest.mock("@/lib/db", () => ({ PostsModel: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: { $transaction: jest.fn(), connectedAccount: { findMany: jest.fn() } } }));
jest.mock("@/lib/mcp/tools/accounts", () => ({
  ...jest.requireActual("@/lib/mcp/tools/accounts"),
  listAccounts: jest.fn().mockResolvedValue({ accounts: [] }),
}));
jest.mock("@/lib/billing/subscriptions", () => ({
  assertCanCreatePost: jest.fn(),
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
jest.mock("@/lib/posting", () => ({
  postToAccounts: jest.fn().mockResolvedValue([{ accountId: "tiktok-1", platform: "tiktok", success: true }]),
  getPostingSummary: jest.fn().mockReturnValue({ overallSuccess: true, successCount: 1, failureCount: 0 }),
}));

const savePost = jest.fn();
const loadPost = jest.fn();
const updatePost = jest.fn();
const accountOptions = {
  "tiktok-1": { privacyLevel: "SELF_ONLY" as const, allowComment: false },
  "youtube-1": { privacyStatus: "unlisted" as const },
};

beforeEach(() => {
  jest.clearAllMocks();
  (PostsModel as jest.Mock).mockImplementation(() => ({
    createPost: savePost,
    updatePost,
    getPostById: loadPost,
  }));
  loadPost.mockReset();
  updatePost.mockReset();
  (prisma.connectedAccount.findMany as jest.Mock).mockImplementation(async ({ where }) =>
    [
      { id: "tiktok-1", platform: "tiktok" },
      { id: "youtube-1", platform: "youtube" },
    ].filter((account) => where.id.in.includes(account.id)),
  );
  savePost.mockImplementation(async (post) => ({ ...post, id: "post-1" }));
  (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => callback({}));
  (validatePostForAccounts as jest.Mock).mockResolvedValue({
    accounts: [
      { id: "tiktok-1", platform: "tiktok" },
      { id: "youtube-1", platform: "youtube" },
    ],
    results: [],
    summary: { isValid: true, errors: [], warnings: [] },
  });
});

it.each(["now", "schedule", "draft"] as const)(
  "preserves account options when creating a %s post",
  async (postingMode) => {
    const result = await createPost(
      "user-1",
      createPostSchema.parse({
        message: "Video",
        accountIds: ["tiktok-1", "youtube-1"],
        accountOptions,
        postingMode,
        ...(postingMode === "schedule" ? { scheduledFor: "2099-01-01T10:00:00Z" } : {}),
      }),
    );
    expect(result.post.accountOptions).toEqual(accountOptions);
    expect(validatePostForAccounts).toHaveBeenCalledWith(expect.objectContaining({ accountOptions }));
    expect(savePost).toHaveBeenCalledWith(expect.objectContaining({ accountOptions }), "user-1", {});
    if (postingMode === "now") {
      expect((postToAccounts as jest.Mock).mock.calls[0][4]).toEqual(accountOptions);
    } else {
      expect(postToAccounts).not.toHaveBeenCalled();
    }
  },
);

it.each(["now", "schedule"] as const)(
  "does not save or dispatch a %s post when platform validation fails",
  async (postingMode) => {
    (validatePostForAccounts as jest.Mock).mockResolvedValue({
      accounts: [{ id: "tiktok-1", platform: "tiktok" }],
      summary: { isValid: false, errors: [{ message: "TikTok audience is unavailable" }] },
    });
    await expect(
      createPost(
        "user-1",
        createPostSchema.parse({
          message: "Video",
          accountIds: ["tiktok-1"],
          postingMode,
          ...(postingMode === "schedule" ? { scheduledFor: "2099-01-01T10:00:00Z" } : {}),
        }),
      ),
    ).rejects.toThrow("TikTok audience is unavailable");
    expect(savePost).not.toHaveBeenCalled();
    expect(postToAccounts).not.toHaveBeenCalled();
  },
);

it("accepts privacy overrides and leaves platform-specific defaulting to the MCP handler", () => {
  for (const schema of [createPostSchema, previewPostSchema, validatePostSchema, updateScheduledPostSchema]) {
    const input = { postId: "post-1", message: "Video", accountIds: ["tiktok-1"] };
    expect(schema.parse(input).accountOptions).toBeUndefined();
    for (const privacyLevel of ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]) {
      const options = { "tiktok-1": { privacyLevel } };
      expect(schema.parse({ ...input, accountOptions: options }).accountOptions).toEqual(options);
    }
    expect(schema.safeParse({ ...input, accountOptions: { "tiktok-1": { privacyLevel: "invalid" } } }).success).toBe(
      false,
    );
  }
});

it.each(["now", "schedule", "draft"] as const)(
  "defaults omitted TikTok privacy to public for %s",
  async (postingMode) => {
    const result = await createPost(
      "user-1",
      createPostSchema.parse({
        message: "Video",
        accountIds: ["tiktok-1", "youtube-1"],
        postingMode,
        ...(postingMode === "schedule" ? { scheduledFor: "2099-01-01T10:00:00Z" } : {}),
      }),
    );
    const expected = { "tiktok-1": { privacyLevel: "PUBLIC_TO_EVERYONE" } };
    expect(result.post.accountOptions).toEqual(expected);
    expect(savePost).toHaveBeenCalledWith(expect.objectContaining({ accountOptions: expected }), "user-1", {});
    expect(validatePostForAccounts).toHaveBeenCalledWith(expect.objectContaining({ accountOptions: expected }));
    if (postingMode === "now") expect((postToAccounts as jest.Mock).mock.calls[0][4]).toEqual(expected);
    else expect(postToAccounts).not.toHaveBeenCalled();
  },
);

it("uses the same public default for validation and previews", async () => {
  (validatePostForAccounts as jest.Mock).mockResolvedValue({
    accounts: [{ id: "tiktok-1", platform: "tiktok" }],
    platforms: ["tiktok"],
    results: [{ accountId: "tiktok-1", platform: "tiktok", isValid: true, errors: [], warnings: [] }],
    summary: { isValid: true, errors: [], warnings: [] },
  });
  const input = { message: "Video", accountIds: ["tiktok-1"] };
  await validatePost("user-1", validatePostSchema.parse(input));
  await previewPost("user-1", previewPostSchema.parse(input));
  for (const [params] of (validatePostForAccounts as jest.Mock).mock.calls) {
    expect(params.accountOptions).toEqual({ "tiktok-1": { privacyLevel: "PUBLIC_TO_EVERYONE" } });
  }
});

it.each([undefined, { "tiktok-1": { privacyLevel: "SELF_ONLY" } }])(
  "preserves saved privacy or persists the default when scheduling a draft",
  async (savedOptions) => {
    const post = {
      id: "post-1",
      message: "Video",
      status: "draft",
      accountIds: ["tiktok-1"],
      accountOptions: savedOptions,
      media: [],
      createdAt: new Date(),
      scheduledFor: null,
    };
    loadPost.mockResolvedValue(post);
    updatePost.mockImplementation(async (_id, updates) => ({ ...post, ...updates }));
    (validatePostForAccounts as jest.Mock).mockResolvedValue({
      accounts: [{ id: "tiktok-1", platform: "tiktok" }],
      platforms: ["tiktok"],
      results: [{ accountId: "tiktok-1", platform: "tiktok", isValid: true, errors: [], warnings: [] }],
      summary: { isValid: true, errors: [], warnings: [] },
    });
    await updateScheduledPost(
      "user-1",
      updateScheduledPostSchema.parse({
        postId: "post-1",
        postingMode: "schedule",
        scheduledFor: "2099-01-01T10:00:00Z",
      }),
    );
    const expected = savedOptions ?? { "tiktok-1": { privacyLevel: "PUBLIC_TO_EVERYONE" } };
    expect(updatePost).toHaveBeenCalledWith("post-1", expect.objectContaining({ accountOptions: expected }));
    expect(validatePostForAccounts).toHaveBeenCalledWith(expect.objectContaining({ accountOptions: expected }));
  },
);

it.each(["public", "draft"])(
  "preserves TikTok carousel and %s options through MCP validation, saving and dispatch",
  async (publishMode) => {
    const options = {
      "tiktok-1": {
        publishMode,
        autoAddMusic: publishMode === "public",
        photoCoverIndex: 3,
        title: "Title",
        description: "Description",
        ...(publishMode === "public" ? { privacyLevel: "SELF_ONLY" } : {}),
      },
    };
    (validatePostForAccounts as jest.Mock).mockResolvedValue({
      accounts: [{ id: "tiktok-1", platform: "tiktok" }],
      results: [],
      summary: { isValid: true, errors: [], warnings: [] },
    });
    const media = Array.from({ length: 7 }, (_, i) => ({ type: "image", url: `https://media.example.com/${i}.jpg` }));
    const result = await createPost(
      "user-1",
      createPostSchema.parse({
        message: "Photos",
        media,
        accountIds: ["tiktok-1"],
        accountOptions: options,
        postingMode: "now",
      }),
    );
    expect(result.post.accountOptions).toEqual(options);
    expect(savePost).toHaveBeenCalledWith(
      expect.objectContaining({
        accountOptions: options,
        media: expect.arrayContaining(media.map((item) => expect.objectContaining(item))),
      }),
      "user-1",
      {},
    );
    expect((postToAccounts as jest.Mock).mock.calls[0][4]).toEqual(options);
    expect(validatePostForAccounts).toHaveBeenCalledWith(expect.objectContaining({ accountOptions: options }));
  },
);
