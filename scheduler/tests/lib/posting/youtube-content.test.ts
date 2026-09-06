import { post as sdkPost } from "@simple-post/sdk";

import { postToAccounts } from "@/lib/posting";
import { prisma } from "@/lib/prisma";
import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import type { ConnectedAccount } from "@/types";

import { validateYouTubeContent } from "../../../../sdk/src/publishers/youtube/validation";

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

const account = { id: "youtube-account", platform: "youtube" } as ConnectedAccount;
const media = [
  { id: "video", type: "video" as const, url: "https://example.com/video.mp4", filename: "video.mp4", size: 1024 },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(prisma.connectedAccount.findMany).mockResolvedValue([account] as never);
  mockResolve.mockImplementation(async (items) => items);
  mockCleanup.mockResolvedValue(undefined);
  jest.mocked(sdkPost).mockImplementation(async ({ content }) => {
    const validation = validateYouTubeContent(content);
    return new Map([
      [
        "youtube",
        {
          id: validation.isValid ? "published-video" : undefined,
          error: validation.isValid ? "NO_ERROR" : "INVALID_CONTENT",
          details: validation,
        },
      ],
    ]) as never;
  });
});

it.each([false, true])(
  "keeps a 444-character caption valid from preflight through publishing (override: %s)",
  async (useOverride) => {
    const caption = "Underwater ambience. ".repeat(23).slice(0, 444);
    const message = useOverride ? "Shared caption" : caption;
    const accountOverrides = useOverride ? { [account.id]: { message: caption, media } } : undefined;
    const preflight = validatePostForResolvedAccounts({ message, media, accounts: [account], accountOverrides });

    expect(preflight.summary.isValid).toBe(true);
    expect(preflight.summary.warnings).toContainEqual(
      expect.objectContaining({ code: "title_truncated", actual: 444 }),
    );

    const [result] = await postToAccounts("user", message, media, [account.id], undefined, accountOverrides);

    expect(result).toMatchObject({ success: true, postId: "published-video" });
    expect(jest.mocked(sdkPost).mock.calls[0][0].content).toEqual({
      text: caption,
      media: [{ type: "video", url: media[0].url, size: media[0].size }],
    });
  },
);

jest.mock("@/lib/posting/durable-publish", () => ({
  publishFingerprint: () => "fingerprint",
  runDurablePublish: async (_input: unknown, publish: () => unknown, prepare?: () => Promise<void>) => {
    await prepare?.();
    return publish();
  },
}));
