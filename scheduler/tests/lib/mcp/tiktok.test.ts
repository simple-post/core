import { getTikTokCreatorInfo } from "@/lib/mcp/tools/tiktok";
import { refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import { reloadAccountSecrets, withAccountLock } from "@/lib/posting/account-lock";
import { prisma } from "@/lib/prisma";
import { fetchTikTokCreatorInfo } from "@/lib/tiktok/creator-info";

jest.mock("@/lib/prisma", () => ({ prisma: { connectedAccount: { findUnique: jest.fn() } } }));
jest.mock("@/lib/security/connected-account-secrets", () => ({
  decryptConnectedAccountSecrets: (account: unknown) => account,
}));
jest.mock("@/lib/oauth/credential-health", () => ({
  POST_CREDENTIAL_MIN_VALIDITY_MS: 60_000,
  refreshConnectedAccountIfNeeded: jest.fn(),
}));
jest.mock("@/lib/posting/account-lock", () => ({ withAccountLock: jest.fn(), reloadAccountSecrets: jest.fn() }));
jest.mock("@/lib/tiktok/creator-info", () => ({ fetchTikTokCreatorInfo: jest.fn() }));

const account = { id: "tiktok-1", userId: "user-1", platform: "tiktok", accessToken: "old-token" };
const creatorInfo = { privacyLevelOptions: ["SELF_ONLY"], canPost: true };

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.connectedAccount.findUnique as jest.Mock).mockResolvedValue(account);
  (withAccountLock as jest.Mock).mockImplementation(async (_id, callback) => callback());
  (reloadAccountSecrets as jest.Mock).mockResolvedValue(account);
  (refreshConnectedAccountIfNeeded as jest.Mock).mockResolvedValue({
    account: { ...account, accessToken: "fresh-token" },
  });
  (fetchTikTokCreatorInfo as jest.Mock).mockResolvedValue(creatorInfo);
});

it("returns creator choices using refreshed credentials under the account lock", async () => {
  const result = await getTikTokCreatorInfo("user-1", { accountId: "tiktok-1" });
  expect(withAccountLock).toHaveBeenCalledWith("tiktok-1", expect.any(Function));
  expect(reloadAccountSecrets).toHaveBeenCalledWith(account);
  expect(fetchTikTokCreatorInfo).toHaveBeenCalledWith("fresh-token");
  expect(result).toEqual({ kind: "tiktok_creator_info", accountId: "tiktok-1", creatorInfo });
  expect(JSON.stringify(result)).not.toContain("token");
});

it.each([
  [null, "Account not found"],
  [{ ...account, userId: "someone-else" }, "permission"],
  [{ ...account, platform: "youtube" }, "only supports TikTok"],
])("rejects inaccessible or unsupported accounts before calling TikTok", async (storedAccount, error) => {
  (prisma.connectedAccount.findUnique as jest.Mock).mockResolvedValue(storedAccount);
  await expect(getTikTokCreatorInfo("user-1", { accountId: "tiktok-1" })).rejects.toThrow(error as string);
  expect(withAccountLock).not.toHaveBeenCalled();
  expect(fetchTikTokCreatorInfo).not.toHaveBeenCalled();
});

it("surfaces refresh failures without using stale credentials", async () => {
  (refreshConnectedAccountIfNeeded as jest.Mock).mockResolvedValue({ account, error: "Reconnect TikTok" });
  await expect(getTikTokCreatorInfo("user-1", { accountId: "tiktok-1" })).rejects.toThrow("Reconnect TikTok");
  expect(fetchTikTokCreatorInfo).not.toHaveBeenCalled();
});

it("preserves posting restrictions returned by TikTok", async () => {
  (fetchTikTokCreatorInfo as jest.Mock).mockResolvedValue({
    ...creatorInfo,
    canPost: false,
    blockReason: "Daily post cap reached",
  });
  expect(await getTikTokCreatorInfo("user-1", { accountId: "tiktok-1" })).toMatchObject({
    creatorInfo: { canPost: false, blockReason: "Daily post cap reached" },
  });
});
