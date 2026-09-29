import { NextRequest } from "next/server";

import { GET, POST } from "@/app/api/connect/pending/[id]/route";
import { upsertConnectedAccount } from "@/lib/oauth";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/config", () => ({ isSocialPlatformEnabled: () => true }));
jest.mock("@/lib/middleware/auth", () => ({ requireAuth: async () => ({ user: { id: "u1" } }) }));
jest.mock("@/lib/oauth", () => ({ upsertConnectedAccount: jest.fn() }));
jest.mock("@/lib/security/connected-account-secrets", () => ({
  decryptConnectedAccountSecrets: (account: Record<string, unknown>) => ({
    ...account,
    accessToken: "decrypted-access",
    refreshToken: "decrypted-refresh",
  }),
}));
jest.mock("@/lib/prisma", () => ({
  prisma: { pendingOAuthConnection: { findFirst: jest.fn(), delete: jest.fn() }, $transaction: jest.fn() },
}));

const page = {
  id: "urn:li:organization:123",
  name: "Company",
  username: "company",
  accountType: "organization",
  accessToken: "encrypted-access",
  refreshToken: "encrypted-refresh",
  expiresAt: "2030-01-01T00:00:00.000Z",
  tokenMetadata: { linkedinMemberId: "member" },
};
const params = { params: Promise.resolve({ id: "pending" }) };
const tx = { pendingOAuthConnection: { delete: jest.fn() } };
const find = prisma.pendingOAuthConnection.findFirst as jest.Mock;
const request = (ids: unknown[]) =>
  new NextRequest("https://simplepost.example/api/connect/pending/pending", {
    method: "POST",
    body: JSON.stringify({ selectedAccountIds: ids }),
  });

beforeEach(() => {
  jest.clearAllMocks();
  find.mockResolvedValue({
    id: "pending",
    userId: "u1",
    platform: "linkedin",
    expiresAt: new Date("2030-01-01"),
    data: { scope: "w_organization_social", accounts: [page] },
  });
  (prisma.$transaction as jest.Mock).mockImplementation((action) => action(tx));
});

it("returns Page identity without any credential or token metadata", async () => {
  const result = await GET(new NextRequest("https://simplepost.example/api/connect/pending/pending"), params);
  const body = await result.json();
  expect(body.accounts).toEqual([{ id: page.id, name: "Company", username: "company", accountType: "organization" }]);
  expect(JSON.stringify(body)).not.toMatch(/encrypted|tokenMetadata|expiresAt/);
  expect(find).toHaveBeenCalledWith({ where: { id: "pending", userId: "u1" } });
});

it("saves the selected Page with refresh capability and expiry instead of making its token permanent", async () => {
  const result = await POST(request([page.id]), params);
  expect(result.status).toBe(200);
  expect(upsertConnectedAccount).toHaveBeenCalledWith(
    expect.objectContaining({
      platformAccountId: page.id,
      accessToken: "decrypted-access",
      refreshToken: "decrypted-refresh",
      expiresAt: new Date(page.expiresAt),
      tokenMetadata: page.tokenMetadata,
    }),
    tx,
  );
  expect(tx.pendingOAuthConnection.delete).toHaveBeenCalledWith({ where: { id: "pending" } });
});

it("rejects an injected destination even alongside a valid selection", async () => {
  const response = await POST(request([page.id, "urn:li:organization:999"]), params);
  expect(response.status).toBe(400);
  expect(upsertConnectedAccount).not.toHaveBeenCalled();
});

it("rejects expired and other users' pending connections", async () => {
  find
    .mockResolvedValueOnce({ id: "pending", platform: "linkedin", expiresAt: new Date(0) })
    .mockResolvedValueOnce(null);
  const expired = await POST(request([page.id]), params);
  const missing = await POST(request([page.id]), params);
  expect(expired.status).toBe(410);
  expect(missing.status).toBe(404);
  expect(upsertConnectedAccount).not.toHaveBeenCalled();
});

it("keeps Facebook's pending Page token behavior", async () => {
  find.mockResolvedValue({
    id: "pending",
    platform: "facebook",
    data: { accounts: [{ id: "fb1", accessToken: "fb-token" }] },
  });
  const response = await POST(request(["fb1"]), params);
  expect(response.status).toBe(200);
  expect(upsertConnectedAccount).toHaveBeenCalledWith(
    expect.objectContaining({ accessToken: "fb-token", refreshToken: null, expiresAt: null }),
    tx,
  );
});
