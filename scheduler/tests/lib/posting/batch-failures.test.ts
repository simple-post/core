import { post as sdkPost } from "@simple-post/sdk";

import { postToAccounts } from "@/lib/posting";
import { prisma } from "@/lib/prisma";

const mockResolve = jest.fn();
const mockCleanup = jest.fn();

jest.mock("@simple-post/sdk", () => ({
  PostErrorType: { NO_ERROR: "NO_ERROR" },
  post: jest.fn(),
  isThreadCapable: (platform: string) => platform === "x",
  buildReplyOverlay: jest.fn(),
  extractChainStep: (_platform: string, result: { id: string }) => ({ postId: result.id }),
  MediaResolver: jest.fn().mockImplementation(() => ({ resolve: mockResolve, cleanup: mockCleanup })),
}));
jest.mock("@/lib/prisma", () => ({ prisma: { connectedAccount: { findMany: jest.fn() } } }));
jest.mock("@/lib/security/connected-account-secrets", () => ({
  decryptConnectedAccountSecrets: (account: unknown) => account,
}));
jest.mock("@/lib/posting/credentials", () => ({
  buildPostOptions: (account: { id: string; platform: string }, options?: Record<string, unknown>) => ({
    [account.platform]: options?.[account.id] ?? {},
  }),
}));
jest.mock("@/lib/posting/account-lock", () => ({
  withAccountLock: (_id: string, fn: () => Promise<unknown>) => fn(),
  reloadAccountSecrets: async (account: unknown) => account,
}));
jest.mock("@/lib/oauth/credential-health", () => ({
  refreshConnectedAccountIfNeeded: async (account: unknown) => ({ account }),
}));
jest.mock("@/lib/observability/telemetry", () => ({
  withAccountPublishSpan: (_operation: string, _platform: string, _attributes: unknown, fn: () => unknown) => fn(),
  withPostingBatch: (_operation: string, _name: string, _attributes: unknown, fn: () => unknown) => fn(),
}));

const media = [
  { id: "media-1", type: "image" as const, url: "https://example.com/media.png", filename: "media.png", size: 100 },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockCleanup.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const qaMessage = "SimplePost QA failure test.";

it("reports the configured QA failure without preparing media or publishing", async () => {
  jest.replaceProperty(process, "env", { ...process.env, QA_PUBLISH_FAILURE_ACCOUNT_ID: "edmund-qa" });
  jest.mocked(prisma.connectedAccount.findMany).mockResolvedValue([{ id: "edmund-qa", platform: "bluesky" }] as never);
  const onResult = jest.fn();

  const results = await postToAccounts(
    "u1",
    qaMessage,
    [],
    ["edmund-qa"],
    undefined,
    undefined,
    undefined,
    undefined,
    onResult,
  );

  expect(results).toEqual([
    {
      accountId: "edmund-qa",
      platform: "bluesky",
      success: false,
      error: "QA_PUBLISH_FAILURE",
      message: "Intentional test publish failure.",
    },
  ]);
  expect(onResult).toHaveBeenCalledWith(results[0]);
  expect(sdkPost).not.toHaveBeenCalled();
  expect(mockResolve).not.toHaveBeenCalled();
});

it.each([
  { id: "edmund-qa", message: qaMessage, accountSetting: undefined },
  { id: "edmund-qa", message: `${qaMessage} Extra text`, accountSetting: "edmund-qa" },
  { id: "other-account", message: qaMessage, accountSetting: "edmund-qa" },
])(
  "publishes normally when the QA setting, account, or exact message does not match ($id, $message)",
  async ({ id, message, accountSetting }) => {
    jest.replaceProperty(process, "env", { ...process.env, QA_PUBLISH_FAILURE_ACCOUNT_ID: accountSetting });
    jest.mocked(prisma.connectedAccount.findMany).mockResolvedValue([{ id, platform: "bluesky" }] as never);
    jest.mocked(sdkPost).mockResolvedValue(new Map([["bluesky", { id: "published", error: "NO_ERROR" }]]) as never);

    await expect(postToAccounts("u1", message, [], [id])).resolves.toEqual([
      expect.objectContaining({ accountId: id, success: true, postId: "published" }),
    ]);
    expect(sdkPost).toHaveBeenCalledTimes(1);
  },
);

it("preserves other results and waits to clean up shared media after one account's download fails", async () => {
  jest.mocked(prisma.connectedAccount.findMany).mockResolvedValue([
    { id: "good", platform: "x" },
    { id: "bad", platform: "telegram" },
  ] as never);
  mockResolve.mockImplementation(async (_media, platforms: string[]) => {
    if (platforms[0] === "telegram") throw new Error("Download failed");
    return media;
  });
  let finishPublish!: () => void;
  let reportStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    reportStarted = resolve;
  });
  jest.mocked(sdkPost).mockImplementation(async () => {
    reportStarted();
    await new Promise<void>((resolve) => {
      finishPublish = resolve;
    });
    return new Map([["x", { id: "published-x", error: "NO_ERROR" }]]) as never;
  });
  const onResult = jest.fn();
  const batch = postToAccounts(
    "u1",
    "hello",
    media,
    ["good", "bad"],
    undefined,
    undefined,
    undefined,
    undefined,
    onResult,
  );
  await started;
  // Let the failed account complete while the successful one is still using
  // the resolver's resources. No real network or timers are involved.
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(mockCleanup).not.toHaveBeenCalled();
  finishPublish();

  const results = await batch;
  expect(results).toEqual([
    expect.objectContaining({ accountId: "good", success: true, postId: "published-x" }),
    expect.objectContaining({ accountId: "bad", success: false, message: "Download failed" }),
  ]);
  expect(onResult).toHaveBeenCalledTimes(2);
  expect(mockCleanup).toHaveBeenCalledTimes(1);
});

it("retains a published thread root when a later segment's media cannot be prepared", async () => {
  jest.useFakeTimers();
  jest.mocked(prisma.connectedAccount.findMany).mockResolvedValue([{ id: "good", platform: "x" }] as never);
  mockResolve.mockRejectedValue(new Error("Reply media unavailable"));
  jest.mocked(sdkPost).mockResolvedValue(new Map([["x", { id: "thread-root", error: "NO_ERROR" }]]) as never);
  const batch = postToAccounts("u1", "root", [], ["good"], undefined, undefined, [
    { message: "reply", media },
    { message: "last reply" },
  ]);
  await jest.runAllTimersAsync();
  const [result] = await batch;

  expect(result).toMatchObject({
    accountId: "good",
    success: false,
    postId: "thread-root",
    threadResults: [
      { index: 0, success: true, postId: "thread-root" },
      { index: 1, success: false, message: "Reply media unavailable" },
      { index: 2, success: false, error: "Skipped due to earlier failure" },
    ],
  });
  expect(sdkPost).toHaveBeenCalledTimes(1);
  expect(mockCleanup).toHaveBeenCalledTimes(1);
});

jest.mock("@/lib/posting/durable-publish", () => ({
  publishFingerprint: () => "fingerprint",
  runDurablePublish: async (_input: unknown, publish: () => unknown, prepare?: () => Promise<void>) => {
    await prepare?.();
    return publish();
  },
}));

it("retries only the failed Story of an Instagram Reel and Story post", async () => {
  jest.mocked(prisma.connectedAccount.findMany).mockResolvedValue([{ id: "ig", platform: "instagram" }] as never);
  const video = { ...media[0], type: "video" as const, url: "https://example.com/video.mp4" };
  mockResolve.mockResolvedValue([video]);
  const publish = jest.mocked(sdkPost);
  publish
    .mockResolvedValueOnce(new Map([["instagram", { id: "reel", error: "NO_ERROR" }]]) as never)
    .mockResolvedValueOnce(new Map([["instagram", { error: "PUBLISH_REJECTED", message: "Story rejected" }]]) as never)
    .mockResolvedValueOnce(new Map([["instagram", { id: "story", error: "NO_ERROR" }]]) as never);
  const options = { ig: { placement: "both" } };
  const context = { postId: "saved-post" };
  const [initial] = await postToAccounts(
    "user",
    "caption",
    [video],
    ["ig"],
    options,
    undefined,
    undefined,
    undefined,
    undefined,
    context,
  );
  expect(initial).toMatchObject({
    success: false,
    postId: "reel",
    placementResults: [
      { placement: "post", success: true, postId: "reel" },
      { placement: "story", success: false, error: "PUBLISH_REJECTED" },
    ],
  });
  const [retry] = await postToAccounts(
    "user",
    "changed caption",
    [video],
    ["ig"],
    options,
    undefined,
    undefined,
    undefined,
    undefined,
    context,
    false,
    { ig: { ...initial, completedAt: "2026-11-26T12:00:00Z" } },
  );
  expect(retry).toMatchObject({
    success: true,
    postId: "reel",
    placementResults: [
      { placement: "post", success: true, postId: "reel" },
      { placement: "story", success: true, postId: "story" },
    ],
  });
  expect(publish.mock.calls.map(([request]) => request.options?.instagram?.placement)).toEqual([
    "post",
    "story",
    "story",
  ]);
});
