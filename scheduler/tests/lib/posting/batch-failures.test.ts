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
jest.mock("@/lib/posting/credentials", () => ({ buildPostOptions: () => ({}) }));
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
  jest.useRealTimers();
});

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
