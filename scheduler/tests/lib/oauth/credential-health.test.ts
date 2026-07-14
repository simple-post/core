import {
  getConnectedAccountCredentialStatus,
  getCredentialIssuesForPublishTime,
  refreshConnectedAccountIfNeeded,
  refreshExpiringConnectedAccounts,
} from "@/lib/oauth/credential-health";
import { prisma } from "@/lib/prisma";
import { encryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import type { ConnectedAccount } from "@/types";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    connectedAccount: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

const prismaMock = prisma as unknown as {
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
  connectedAccount: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    updateMany: jest.Mock;
  };
};

const now = new Date("2026-07-07T10:00:00.000Z");
const fetchMock = jest.fn();

function account(overrides: Partial<ConnectedAccount> = {}): ConnectedAccount {
  return {
    accessToken: "old-access",
    createdAt: now,
    displayName: "Test Account",
    email: null,
    expiresAt: new Date("2026-07-07T10:01:00.000Z"),
    id: "acct-1",
    platform: "linkedin",
    platformAccountId: "person-1",
    profilePicture: null,
    refreshToken: null,
    scope: null,
    tokenMetadata: null,
    tokenType: "Bearer",
    updatedAt: now,
    userId: "user-1",
    username: "tester",
    ...overrides,
  };
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(now);
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  prismaMock.$queryRaw.mockResolvedValue([]);
  prismaMock.$transaction.mockImplementation(async (callback: (client: typeof prismaMock) => unknown) =>
    callback(prismaMock),
  );
  prismaMock.connectedAccount.updateMany.mockResolvedValue({ count: 1 });
  process.env.LINKEDIN_CLIENT_ID = "linkedin-client";
  process.env.LINKEDIN_CLIENT_SECRET = "linkedin-secret";
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env.LINKEDIN_CLIENT_ID;
  delete process.env.LINKEDIN_CLIENT_SECRET;
});

describe("connected account credential health", () => {
  it("warns when a valid expiring token has no refresh path", () => {
    const status = getConnectedAccountCredentialStatus(
      account({
        expiresAt: new Date("2026-08-01T10:00:00.000Z"),
        platform: "pinterest",
        refreshToken: null,
      }),
    );

    expect(status.state).toBe("refresh_unavailable");
    expect(status.severity).toBe("warning");
    expect(status.action).toBe("reconnect");
  });

  it("shows a valid LinkedIn account as active when no refresh token was issued", () => {
    const status = getConnectedAccountCredentialStatus(
      account({
        expiresAt: new Date("2026-08-01T10:00:00.000Z"),
        platform: "linkedin",
        refreshToken: null,
      }),
    );

    expect(status.state).toBe("healthy");
    expect(status.severity).toBe("ok");
    expect(status.label).toBe("Active");
    expect(status.action).toBe("none");
  });

  it("warns when LinkedIn has a refresh token but client credentials are not configured", () => {
    delete process.env.LINKEDIN_CLIENT_ID;

    const status = getConnectedAccountCredentialStatus(
      account({
        expiresAt: new Date("2026-08-01T10:00:00.000Z"),
        platform: "linkedin",
        refreshToken: "stored-refresh",
      }),
    );

    expect(status.state).toBe("refresh_unavailable");
    expect(status.severity).toBe("warning");
    expect(status.action).toBe("reconnect");
  });

  it.each([
    ["bluesky", "Bluesky token refresh failed (400): Invalid refresh token"],
    ["x", "X token refresh failed (400): Value passed for the token was invalid."],
    [
      "instagram",
      "Instagram token refresh failed (400): The session has been invalidated because the user changed their password.",
    ],
    ["youtube", "YouTube token refresh failed (400): Bad Request"],
  ])("shows historical permanent %s failures as reconnect-required", (platform, lastRefreshError) => {
    const status = getConnectedAccountCredentialStatus(
      account({
        expiresAt: new Date("2026-08-01T10:00:00.000Z"),
        platform,
        refreshToken: "stored-refresh",
        tokenMetadata: {
          lastRefreshError,
          lastRefreshErrorAt: "2026-07-06T10:00:00.000Z",
        },
      }),
    );

    expect(status.state).toBe("reauth_required");
    expect(status.severity).toBe("error");
    expect(status.label).toBe("Reconnect");
    expect(status.action).toBe("reconnect");
  });

  it("requires reconnect when an expired token has no refresh path", () => {
    const status = getConnectedAccountCredentialStatus(
      account({
        expiresAt: new Date("2026-07-07T09:59:00.000Z"),
        refreshToken: null,
      }),
    );

    expect(status.state).toBe("reauth_required");
    expect(status.severity).toBe("error");
  });

  it("refreshes LinkedIn credentials before posting and persists the rotated token", async () => {
    const storedAccount = account({ refreshToken: "old-refresh" });
    prismaMock.connectedAccount.findUnique.mockResolvedValue(encryptConnectedAccountSecrets(storedAccount));
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "new-access",
          expires_in: 3600,
          refresh_token: "new-refresh",
          refresh_token_expires_in: 86_400,
        }),
        { status: 200 },
      ),
    );

    const result = await refreshConnectedAccountIfNeeded(storedAccount, {
      minValidityMs: 5 * 60 * 1000,
      reason: "post",
    });

    expect(result.refreshed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.account.accessToken).toBe("new-access");
    expect(result.account.refreshToken).toBe("new-refresh");
    expect(result.account.expiresAt?.toISOString()).toBe("2026-07-07T11:00:00.000Z");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.linkedin.com/oauth/v2/accessToken");
    expect((init.body as URLSearchParams).get("grant_type")).toBe("refresh_token");
    expect((init.body as URLSearchParams).get("refresh_token")).toBe("old-refresh");
    expect(prismaMock.connectedAccount.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.connectedAccount.findUnique.mock.invocationCallOrder[0],
    );
    expect(prismaMock.connectedAccount.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0],
    );
  });

  it("fails open when refresh fails but the token is not yet expired", async () => {
    const storedAccount = account({
      expiresAt: new Date("2026-07-07T10:04:00.000Z"),
      refreshToken: "old-refresh",
    });
    prismaMock.connectedAccount.findUnique.mockResolvedValue(encryptConnectedAccountSecrets(storedAccount));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "temporarily_unavailable" }), { status: 503 }));

    const result = await refreshConnectedAccountIfNeeded(
      // Within the 5-minute refresh buffer but not expired yet.
      storedAccount,
      { minValidityMs: 5 * 60 * 1000, reason: "post" },
    );

    expect(result.refreshed).toBe(false);
    expect(result.refreshError).toContain("LinkedIn token refresh failed (503)");
    expect(result.error).toBeUndefined();
    expect(result.account.accessToken).toBe("old-access");
    expect(prismaMock.connectedAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          credentialRefreshBlockedAt: null,
          credentialRefreshRetryAt: new Date("2026-07-07T11:00:00.000Z"),
        }),
      }),
    );
  });

  it("blocks posting when refresh fails and the token is already expired", async () => {
    const storedAccount = account({
      expiresAt: new Date("2026-07-07T09:00:00.000Z"),
      refreshToken: "old-refresh",
    });
    prismaMock.connectedAccount.findUnique.mockResolvedValue(encryptConnectedAccountSecrets(storedAccount));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));

    const result = await refreshConnectedAccountIfNeeded(storedAccount, {
      minValidityMs: 5 * 60 * 1000,
      reason: "post",
    });

    expect(result.refreshed).toBe(false);
    expect(result.error).toContain("LinkedIn token refresh failed (400): invalid_grant");
    expect(result.refreshError).toBe(result.error);
    expect(result.status.state).toBe("reauth_required");
    expect(result.status.action).toBe("reconnect");
    expect(prismaMock.connectedAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          credentialRefreshBlockedAt: now,
          credentialRefreshRetryAt: null,
        }),
      }),
    );
  });

  it("does not overwrite credentials when a reconnect wins the compare-and-swap", async () => {
    const staleAccount = account({ refreshToken: "old-refresh" });
    const reconnectedAccount = account({
      accessToken: "reconnected-access",
      expiresAt: new Date("2026-07-07T12:00:00.000Z"),
      refreshToken: "reconnected-refresh",
      updatedAt: new Date("2026-07-07T10:00:02.000Z"),
    });
    prismaMock.connectedAccount.findUnique
      .mockResolvedValueOnce(encryptConnectedAccountSecrets(staleAccount))
      .mockResolvedValueOnce(encryptConnectedAccountSecrets(reconnectedAccount));
    prismaMock.connectedAccount.updateMany.mockResolvedValue({ count: 0 });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: "stale-session-access", expires_in: 3600, refresh_token: "rotated" }),
        {
          status: 200,
        },
      ),
    );

    const result = await refreshConnectedAccountIfNeeded(staleAccount, {
      minValidityMs: 5 * 60 * 1000,
      reason: "post",
    });

    expect(result.refreshed).toBe(false);
    expect(result.refreshError).toBeUndefined();
    expect(result.account.accessToken).toBe("reconnected-access");
    expect(result.account.refreshToken).toBe("reconnected-refresh");
    expect(prismaMock.connectedAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "acct-1", updatedAt: now } }),
    );
  });

  it("backfills the database block when a historical permanent failure is processed", async () => {
    const storedAccount = account({
      expiresAt: new Date("2026-07-07T09:00:00.000Z"),
      platform: "bluesky",
      refreshToken: "invalid-refresh",
      tokenMetadata: {
        lastRefreshError: "Bluesky token refresh failed (400): Invalid refresh token",
        lastRefreshErrorAt: "2026-07-06T10:00:00.000Z",
      },
    });
    prismaMock.connectedAccount.findUnique.mockResolvedValue(encryptConnectedAccountSecrets(storedAccount));

    const result = await refreshConnectedAccountIfNeeded(storedAccount, {
      minValidityMs: 5 * 60 * 1000,
      reason: "background",
    });

    expect(result.status.state).toBe("reauth_required");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prismaMock.connectedAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          credentialRefreshBlockedAt: now,
          credentialRefreshRetryAt: null,
        }),
      }),
    );
  });

  it("flags scheduled posts whose account token will expire before publish and cannot refresh", async () => {
    prismaMock.connectedAccount.findMany.mockResolvedValue([
      encryptConnectedAccountSecrets(
        account({
          expiresAt: new Date("2026-07-07T10:10:00.000Z"),
          refreshToken: null,
        }),
      ),
    ]);

    const issues = await getCredentialIssuesForPublishTime({
      accountIds: ["acct-1"],
      publishAt: new Date("2026-07-07T10:15:00.000Z"),
      userId: "user-1",
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("access token expires before the publish time");
  });

  it("prevents scheduling with credentials a provider permanently rejected", async () => {
    prismaMock.connectedAccount.findMany.mockResolvedValue([
      encryptConnectedAccountSecrets(
        account({
          credentialRefreshBlockedAt: now,
          expiresAt: new Date("2026-07-08T10:00:00.000Z"),
          refreshToken: "invalid-refresh-token",
        }),
      ),
    ]);

    const issues = await getCredentialIssuesForPublishTime({
      accountIds: ["acct-1"],
      publishAt: new Date("2026-07-07T10:15:00.000Z"),
      userId: "user-1",
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("rejected the stored credentials");
  });

  it("prevents scheduling with a historical permanent refresh failure", async () => {
    prismaMock.connectedAccount.findMany.mockResolvedValue([
      encryptConnectedAccountSecrets(
        account({
          expiresAt: new Date("2026-07-08T10:00:00.000Z"),
          platform: "x",
          refreshToken: "invalid-refresh-token",
          tokenMetadata: {
            lastRefreshError: "X token refresh failed (400): Value passed for the token was invalid.",
            lastRefreshErrorAt: "2026-07-06T10:00:00.000Z",
          },
        }),
      ),
    ]);

    const issues = await getCredentialIssuesForPublishTime({
      accountIds: ["acct-1"],
      publishAt: new Date("2026-07-07T10:15:00.000Z"),
      userId: "user-1",
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("rejected the stored credentials");
  });
});

describe("refreshExpiringConnectedAccounts", () => {
  it("only sweeps accounts whose access token expires within the short sweep window", async () => {
    prismaMock.connectedAccount.findMany.mockResolvedValue([]);

    await refreshExpiringConnectedAccounts();

    const query = prismaMock.connectedAccount.findMany.mock.calls[0][0];
    expect(query.where.expiresAt.lte).toEqual(new Date("2026-07-07T10:30:00.000Z"));
    expect(query.where.credentialRefreshBlockedAt).toBeNull();
    expect(query.where.OR).toEqual([{ credentialRefreshRetryAt: null }, { credentialRefreshRetryAt: { lte: now } }]);
  });

  it("refreshes an account expiring within the window and persists it", async () => {
    const storedAccount = encryptConnectedAccountSecrets(
      account({
        expiresAt: new Date("2026-07-07T10:10:00.000Z"),
        refreshToken: "old-refresh",
      }),
    );
    prismaMock.connectedAccount.findMany.mockResolvedValue([storedAccount]);
    prismaMock.connectedAccount.findUnique.mockResolvedValue(storedAccount);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: "new-access", expires_in: 3600, refresh_token: "new-refresh" }), {
        status: 200,
      }),
    );

    const result = await refreshExpiringConnectedAccounts();

    expect(result).toMatchObject({ checked: 1, failed: 0, refreshed: 1, skipped: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.connectedAccount.updateMany).toHaveBeenCalledTimes(1);
  });

  it("does not re-refresh an account whose token was already refreshed", async () => {
    prismaMock.connectedAccount.findMany.mockResolvedValue([
      encryptConnectedAccountSecrets(
        account({
          // Fresh token: outside minValidity, so refresh must be skipped even
          // though the row matched the sweep query.
          expiresAt: new Date("2026-07-07T11:30:00.000Z"),
          refreshToken: "current-refresh",
        }),
      ),
    ]);
    prismaMock.connectedAccount.findUnique.mockResolvedValue(null);

    const result = await refreshExpiringConnectedAccounts();

    expect(result).toMatchObject({ checked: 1, failed: 0, refreshed: 0, skipped: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prismaMock.connectedAccount.updateMany).not.toHaveBeenCalled();
  });

  it("skips broken accounts that are still in their retry cooldown", async () => {
    prismaMock.connectedAccount.findMany.mockResolvedValue([
      encryptConnectedAccountSecrets(
        account({
          expiresAt: new Date("2026-07-07T09:00:00.000Z"),
          refreshToken: "old-refresh",
          tokenMetadata: {
            lastRefreshError: "LinkedIn token refresh failed (400): invalid_grant",
            lastRefreshErrorAt: "2026-07-07T09:55:00.000Z",
          },
        }),
      ),
    ]);

    const result = await refreshExpiringConnectedAccounts();

    expect(result).toMatchObject({ checked: 1, failed: 0, refreshed: 0, skipped: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prismaMock.connectedAccount.updateMany).not.toHaveBeenCalled();
  });

  it("counts refresh failures without throwing", async () => {
    const storedAccount = encryptConnectedAccountSecrets(
      account({
        expiresAt: new Date("2026-07-07T09:00:00.000Z"),
        refreshToken: "old-refresh",
      }),
    );
    prismaMock.connectedAccount.findMany.mockResolvedValue([storedAccount]);
    prismaMock.connectedAccount.findUnique.mockResolvedValue(storedAccount);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));

    const result = await refreshExpiringConnectedAccounts();

    expect(result).toMatchObject({ checked: 1, failed: 1, refreshed: 0, skipped: 0 });
    expect(result.failures[0].message).toContain("LinkedIn token refresh failed (400)");
  });
});
