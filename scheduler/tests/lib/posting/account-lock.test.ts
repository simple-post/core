import { reloadAccountSecrets } from "@/lib/posting/account-lock";
import { prisma } from "@/lib/prisma";
import { encryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import type { ConnectedAccount } from "@/types";

jest.mock("@/lib/prisma", () => ({ prisma: { connectedAccount: { findUnique: jest.fn() } } }));

it("reloads the complete health state and credential generation rather than retaining stale flags", async () => {
  const old = {
    id: "account",
    updatedAt: new Date("2026-09-27"),
    credentialRefreshBlockedAt: null,
  } as ConnectedAccount;
  const fresh = {
    ...old,
    updatedAt: new Date("2026-10-03"),
    credentialRefreshBlockedAt: new Date("2026-10-03"),
    credentialRefreshRetryAt: null,
    expiresAt: new Date("2026-11-26"),
    ...encryptConnectedAccountSecrets({
      accessToken: "fresh-token",
      refreshToken: null,
      tokenMetadata: { diagnosis: "revoked" },
    }),
  };
  jest.mocked(prisma.connectedAccount.findUnique).mockResolvedValue(fresh as never);
  const result = await reloadAccountSecrets(old);
  expect(result).toMatchObject({
    accessToken: "fresh-token",
    tokenMetadata: { diagnosis: "revoked" },
    updatedAt: fresh.updatedAt,
    credentialRefreshBlockedAt: fresh.credentialRefreshBlockedAt,
    credentialRefreshRetryAt: null,
  });
});
