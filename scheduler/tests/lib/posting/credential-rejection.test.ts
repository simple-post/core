import { recordInstagramCredentialRejection, recordRevokedInstagramSession } from "@/lib/posting/credential-rejection";
import { prisma } from "@/lib/prisma";
import { decryptTokenMetadata, encryptTokenMetadata } from "@/lib/security/connected-account-secrets";

jest.mock("@/lib/prisma", () => ({ prisma: { $transaction: jest.fn() } }));
jest.mock("@/lib/oauth/connected-account-lock", () => ({
  acquireConnectedAccountCredentialLock: jest.fn(),
  CONNECTED_ACCOUNT_CREDENTIAL_TRANSACTION_OPTIONS: {},
}));

const account = { id: "account", platform: "instagram", updatedAt: new Date("2026-09-08T08:00:00Z") };
const rejection = { reason: "session_revoked" as const, code: 190, status: 401, subcode: 0 };
const findUnique = jest.fn();
const updateMany = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  findUnique.mockResolvedValue({
    ...account,
    credentialRefreshBlockedAt: null,
    tokenMetadata: encryptTokenMetadata({ existing: "preserved" }),
  });
  updateMany.mockResolvedValue({ count: 1 });
  (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn({ connectedAccount: { findUnique, updateMany } }));
});

it("records an encrypted diagnosis once, preserving metadata and credential-generation guards", async () => {
  expect(await recordInstagramCredentialRejection(account, rejection)).toBe("recorded");
  const update = updateMany.mock.calls[0][0];
  expect(update.where).toEqual({ id: account.id, updatedAt: account.updatedAt, credentialRefreshBlockedAt: null });
  expect(update.data).toMatchObject({ credentialRefreshBlockedAt: expect.any(Date), credentialRefreshRetryAt: null });
  expect(update.data).not.toHaveProperty("accessToken");
  expect(decryptTokenMetadata(update.data.tokenMetadata)).toMatchObject({
    existing: "preserved",
    credentialRejection: { ...rejection, detectedAt: expect.any(String) },
  });
  findUnique.mockResolvedValue({ ...account, ...update.data });
  expect(await recordInstagramCredentialRejection(account, rejection)).toBe("already_blocked");
  expect(updateMany).toHaveBeenCalledTimes(1);
});

it("preserves a newer reconnect and does not mark deleted accounts", async () => {
  findUnique.mockResolvedValueOnce({ ...account, updatedAt: new Date(account.updatedAt.getTime() + 1) });
  expect(await recordInstagramCredentialRejection(account, rejection)).toBe("stale");
  findUnique.mockResolvedValueOnce(null);
  expect(await recordInstagramCredentialRejection(account, rejection)).toBe("stale");
  expect(updateMany).not.toHaveBeenCalled();
});

it("handles a lost compare-and-swap without reporting a successful transition", async () => {
  updateMany.mockResolvedValueOnce({ count: 0 });
  expect(await recordInstagramCredentialRejection(account, rejection)).toBe("stale");
});

it("records revocation from both raw provider rejections and SDK preflight results", async () => {
  await recordRevokedInstagramSession(account, { error: { code: 190, message: "The session has been invalidated." } });
  await recordRevokedInstagramSession(account, [{ platform: "instagram", credentialRejection: rejection }]);
  expect(updateMany).toHaveBeenCalledTimes(2);
});

it("does not block accounts for quota, ordinary expiration, incomplete evidence, or other platforms", async () => {
  for (const message of [
    "Verify your email",
    "Upload limit exceeded",
    "Token expired",
    "session has been invalidated",
  ]) {
    await recordRevokedInstagramSession(account, { message });
  }
  await recordRevokedInstagramSession(
    { ...account, platform: "bluesky" },
    { error: { code: 190, error_subcode: 460 } },
  );
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
