import { recordRevokedInstagramSession } from "@/lib/posting/credential-rejection";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({ prisma: { $transaction: jest.fn() } }));
jest.mock("@/lib/oauth/connected-account-lock", () => ({
  acquireConnectedAccountCredentialLock: jest.fn(),
  CONNECTED_ACCOUNT_CREDENTIAL_TRANSACTION_OPTIONS: {},
}));

const account = { id: "account", platform: "instagram", updatedAt: new Date("2026-09-08T08:00:00Z") };
beforeEach(() => jest.clearAllMocks());

it("marks explicit revocation with a concurrency guard, without changing tokens", async () => {
  const updateMany = jest.fn().mockResolvedValue({ count: 0 });
  (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn({ connectedAccount: { updateMany } }));
  await recordRevokedInstagramSession(account, {
    details: "The session has been invalidated because the user changed their password.",
  });
  expect(updateMany).toHaveBeenCalledWith({
    where: { id: account.id, updatedAt: account.updatedAt },
    data: { credentialRefreshBlockedAt: expect.any(Date), credentialRefreshRetryAt: null },
  });
});

it("does not block accounts for email verification, quota, or ordinary expiration", async () => {
  for (const message of ["Verify your Bluesky account email", "Upload limit exceeded", "Token expired"]) {
    await recordRevokedInstagramSession(account, { message });
  }
  await recordRevokedInstagramSession({ ...account, platform: "bluesky" }, { message: "session has been invalidated" });
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
