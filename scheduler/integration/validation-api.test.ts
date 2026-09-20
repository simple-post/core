import { NextRequest } from "next/server";

import { Feature } from "@prisma/client";
import { hydrateRemoteMediaSizesForAccounts, post as sdkPost, validatePostReadiness } from "@simple-post/sdk";

import { PATCH as update } from "@/app/api/v1/posts/[id]/route";
import { POST as create } from "@/app/api/v1/posts/route";
import { POST as validate } from "@/app/api/v1/validation/route";
import { PostsModel } from "@/lib/db";
import { validatePost } from "@/lib/mcp/tools/validation";
import { requireAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";

// Real handlers, schemas, shared validators and disposable PostgreSQL. Only
// authentication, secret loading and provider I/O are substituted.
jest.mock("@simple-post/sdk", () => ({
  ...jest.requireActual("@simple-post/sdk"),
  hydrateRemoteMediaSizesForAccounts: jest.fn(),
  post: jest.fn(),
  validatePostReadiness: jest.fn(),
}));
jest.mock("@/lib/middleware/auth", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/security/connected-account-secrets", () => ({
  ...jest.requireActual("@/lib/security/connected-account-secrets"),
  decryptConnectedAccountSecrets: (account: unknown) => account,
}));
jest.mock("@/lib/oauth/credential-health", () => ({
  refreshConnectedAccountIfNeeded: async (account: unknown) => ({ account }),
  getCredentialIssuesForPublishTime: async () => [],
}));
jest.mock("@/lib/webhooks", () => ({ dispatchPostWebhooks: jest.fn() }));

const userId = "validation-review-user";
const request = (body: unknown, method = "POST", id = "") =>
  new NextRequest(`http://localhost/api/v1/posts/${id}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(async () => {
  jest.resetAllMocks();
  delete process.env.SELF_HOSTED;
  await prisma.publishCheckpoint.deleteMany();
  await prisma.publishAttempt.deleteMany();
  await prisma.storageDeletion.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.create({
    data: {
      id: userId,
      name: "Validation",
      email: "validation@example.invalid",
      freeTrial: { create: { expiresAt: new Date(Date.now() + 86_400_000) } },
    },
  });
  await prisma.connectedAccount.createMany({
    data: ["telegram", "bluesky", "forem", "instagram"].map((platform) => ({
      id: platform,
      userId,
      platform,
      platformAccountId: "12345",
      accessToken: "fake",
    })),
  });
  jest.mocked(requireAuth).mockResolvedValue({ user: { id: userId } } as never);
  jest.mocked(hydrateRemoteMediaSizesForAccounts).mockResolvedValue([]);
  jest.mocked(validatePostReadiness).mockResolvedValue([]);
});
afterAll(async () => {
  await prisma.$disconnect();
});
async function noPublish() {
  expect(sdkPost).not.toHaveBeenCalled();
  expect(await prisma.publishAttempt.count()).toBe(0);
  expect(await prisma.publishCheckpoint.count()).toBe(0);
}

it("schedules beyond trial expiry and returns a publish warning", async () => {
  const scheduledFor = new Date(Date.now() + 2 * 86_400_000);
  const response = await create(
    request({
      message: "Future post",
      accountIds: ["telegram"],
      postingMode: "schedule",
      scheduledFor: scheduledFor.toISOString(),
    }),
  );

  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.post).toMatchObject({ status: "scheduled", scheduledFor: scheduledFor.toISOString() });
  expect(body.warnings).toEqual([
    expect.objectContaining({
      code: "TRIAL_EXPIRES_BEFORE_PUBLISH",
      message: expect.stringContaining("will not publish"),
    }),
  ]);
  expect(await prisma.post.count()).toBe(1);
  await noPublish();
});
const cases = [
  { name: "Unicode bytes", accountIds: ["bluesky"], message: "👨‍👩‍👧‍👦".repeat(121), code: "text_bytes_exceeded" },
  {
    name: "final options",
    accountIds: ["forem"],
    message: "Body",
    accountOptions: { forem: { title: "T".repeat(129) } },
    code: "title_too_long",
  },
  {
    name: "account override",
    accountIds: ["telegram"],
    message: "valid root",
    accountOverrides: { telegram: { message: "<b>broken" } },
    code: "telegram_entities_invalid",
  },
  {
    name: "thread child",
    accountIds: ["telegram"],
    message: "valid root",
    thread: [{ message: "<b>broken" }],
    code: "telegram_entities_invalid",
  },
];
for (const input of cases)
  for (const postingMode of ["now", "schedule"]) {
    it(`HTTP ${postingMode} rejects ${input.name} without creating posts or consuming a publish attempt`, async () => {
      const response = await create(
        request({ ...input, postingMode, scheduledFor: new Date(Date.now() + 3_600_000).toISOString() }),
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.details.summary.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: input.code, severity: "error" })]),
      );
      expect(await prisma.post.count()).toBe(0);
      await noPublish();
    });
  }
it("MCP returns the exact formatting issue and account identity without persistence or publishing", async () => {
  const result = await validatePost(userId, {
    accountIds: ["telegram"],
    message: "unescaped.",
    accountOptions: { telegram: { parseMode: "MarkdownV2" } },
  });
  expect(result.isValid).toBe(false);
  expect(result.accounts).toEqual([
    expect.objectContaining({
      accountId: "telegram",
      isValid: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "telegram_entities_invalid", field: "text", severity: "error" }),
      ]),
    }),
  ]);
  expect(await prisma.post.count()).toBe(0);
  await noPublish();
});
it("an invalid edit cannot schedule a saved draft or overwrite its original content", async () => {
  const draft = await new PostsModel(userId).createPost(
    { message: "Original", media: [], accountIds: ["telegram"], status: "draft", scheduledFor: null },
    userId,
  );
  const before = await prisma.post.findUniqueOrThrow({ where: { id: draft.id } });
  const response = await update(
    request(
      {
        message: "*unclosed",
        accountIds: ["telegram"],
        accountOptions: { telegram: { parseMode: "MarkdownV2" } },
        postingMode: "schedule",
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      },
      "PATCH",
      draft.id,
    ),
    { params: Promise.resolve({ id: draft.id }) },
  );
  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body.code).toBe("VALIDATION_ERROR");
  expect(await prisma.post.findUniqueOrThrow({ where: { id: draft.id } })).toEqual(before);
  await noPublish();
});
it.each(["create", "update"] as const)(
  "a fixable image error cannot %s a draft when image fitting is enabled",
  async (operation) => {
    await prisma.userFeature.create({ data: { userId, feature: Feature.IMAGE_FITTING } });
    jest.mocked(hydrateRemoteMediaSizesForAccounts).mockResolvedValue([
      {
        platform: "instagram",
        code: "media_aspect_ratio_unsupported",
        severity: "error",
        message: "Instagram image aspect ratio 0.488 is outside the supported range.",
        field: "text.media[0]",
        meta: { accountId: "instagram" },
      },
    ]);

    const existing =
      operation === "update"
        ? await new PostsModel(userId).createPost(
            { message: "Original", media: [], accountIds: ["instagram"], status: "draft", scheduledFor: null },
            userId,
          )
        : null;
    const response =
      operation === "create"
        ? await create(request({ message: "Photo", accountIds: ["instagram"], postingMode: "draft" }))
        : await update(
            request(
              { message: "Updated", accountIds: ["instagram"], postingMode: "draft", media: [] },
              "PATCH",
              existing!.id,
            ),
            { params: Promise.resolve({ id: existing!.id }) },
          );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details.imageFitHelp).toMatch(/crop.*blur.*imageFit/);
    expect(body.details.summary.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "media_aspect_ratio_unsupported" })]),
    );
    if (existing) {
      const persisted = await prisma.post.findUniqueOrThrow({ where: { id: existing.id } });
      expect(persisted.message).toBe("Original");
    } else {
      expect(await prisma.post.count()).toBe(0);
    }
    await noPublish();
  },
);
it("offers feature-gated image fitting through the shared HTTP validation endpoint", async () => {
  await prisma.userFeature.create({ data: { userId, feature: Feature.IMAGE_FITTING } });
  jest.mocked(hydrateRemoteMediaSizesForAccounts).mockResolvedValue([
    {
      platform: "instagram",
      code: "image_format_unsupported",
      severity: "error",
      message: "Instagram does not support PNG images.",
      field: "text.media[0]",
      meta: { accountId: "instagram" },
    },
  ]);

  const response = await validate(request({ message: "Photo", accountIds: ["instagram"], media: [] }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.summary.isValid).toBe(false);
  expect(body.imageFitHelp).toMatch(/crop.*blur.*imageFit/);
  expect(await prisma.post.count()).toBe(0);
});
it("a live account denial blocks otherwise valid content before posting or persistence", async () => {
  jest.mocked(validatePostReadiness).mockResolvedValue([
    {
      platform: "telegram",
      code: "account_ineligible",
      severity: "error",
      message: "Bot cannot post in this channel",
    },
  ]);
  const response = await create(request({ message: "Valid text", accountIds: ["telegram"], postingMode: "now" }));
  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body.details.summary.errors).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "account_ineligible" })]),
  );
  expect(validatePostReadiness).toHaveBeenCalledTimes(1);
  expect(await prisma.post.count()).toBe(0);
  await noPublish();
});
it("saving a draft does not depend on live provider readiness", async () => {
  jest.mocked(validatePostReadiness).mockResolvedValue([
    {
      platform: "telegram",
      code: "account_ineligible",
      severity: "error",
      message: "Bot cannot post in this channel",
    },
  ]);

  const response = await create(
    request({ message: "Work in progress", accountIds: ["telegram"], postingMode: "draft" }),
  );
  expect(response.status).toBe(201);
  expect(validatePostReadiness).not.toHaveBeenCalled();
  expect(await prisma.post.count({ where: { status: "draft" } })).toBe(1);
  await noPublish();
});
