import { getBillingStatus } from "@/lib/billing/subscriptions";
import { listAccounts, listAccountsOutputSchema } from "@/lib/mcp/tools/accounts";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/billing/subscriptions", () => ({ getBillingStatus: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: { connectedAccount: { findMany: jest.fn() } } }));
jest.mock("@/lib/security/connected-account-secrets", () => ({
  decryptConnectedAccountSecrets: (value: unknown) => value,
}));
jest.mock("@/lib/oauth/credential-health", () => ({
  getConnectedAccountCredentialStatus: () => ({
    state: "healthy",
    severity: "ok",
    label: "Ready",
    message: "Ready",
    action: "none",
    expiresAt: null,
    refreshTokenExpiresAt: null,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.connectedAccount.findMany as jest.Mock).mockResolvedValue(
    ["twitter", "x", "instagram"].map((platform, index) => ({
      id: `account-${index}`,
      platform,
      username: "test",
      displayName: null,
      profilePicture: null,
      accessToken: "private-token",
    })),
  );
});

it("shows shared trial allowance before posting without leaking private billing or account fields", async () => {
  (getBillingStatus as jest.Mock).mockResolvedValue({
    accessType: "trial",
    subscription: { stripeCustomerId: "private-customer" },
    trial: { postsPerPlatform: 5, platformUsage: { x: 6 }, expiresAt: "2026-09-10T00:00:00Z" },
  });
  const result = await listAccounts("user");
  expect(listAccountsOutputSchema.safeParse(result).success).toBe(true);
  expect(result.accounts.map((account) => account.trialAllowance?.remaining)).toEqual([0, 0, 5]);
  expect(result.accounts[0].trialAllowance).toEqual(result.accounts[1].trialAllowance);
  expect(JSON.stringify(result)).not.toContain("private-");
  expect(getBillingStatus).toHaveBeenCalledWith("user");
});

it("does not show an old trial cap after upgrading", async () => {
  (getBillingStatus as jest.Mock).mockResolvedValue({
    accessType: "stripe",
    trial: { postsPerPlatform: 5, platformUsage: { x: 5 }, expiresAt: "2026-09-10T00:00:00Z" },
  });
  const result = await listAccounts("user");
  expect(result.accounts.every((account) => account.trialAllowance === undefined)).toBe(true);
});
