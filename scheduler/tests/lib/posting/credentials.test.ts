import { buildCredentials } from "@/lib/posting/credentials";
import type { ConnectedAccount } from "@/types";

const now = new Date("2026-07-14T20:00:00.000Z");

function account(overrides: Partial<ConnectedAccount>): ConnectedAccount {
  return {
    accessToken: "access-token",
    createdAt: now,
    displayName: "Test Account",
    email: null,
    expiresAt: new Date("2026-07-14T21:00:00.000Z"),
    id: "acct-1",
    platform: "x",
    platformAccountId: "platform-user-1",
    profilePicture: null,
    refreshToken: "rotating-refresh-token",
    scope: null,
    tokenMetadata: null,
    tokenType: "Bearer",
    updatedAt: now,
    userId: "user-1",
    username: "tester",
    ...overrides,
  };
}

describe("posting credentials", () => {
  it("never exposes the X refresh token to the posting SDK", () => {
    const credentials = buildCredentials(account({ platform: "x" }));

    expect(credentials).toMatchObject({
      accessToken: "access-token",
      expiresAt: Math.floor(new Date("2026-07-14T21:00:00.000Z").getTime() / 1000),
      userId: "platform-user-1",
    });
    expect(credentials).not.toHaveProperty("refreshToken");
    expect(credentials).not.toHaveProperty("clientId");
    expect(credentials).not.toHaveProperty("clientSecret");
  });

  it("never exposes the YouTube refresh token to googleapis", () => {
    const credentials = buildCredentials(account({ platform: "youtube" }));

    expect(credentials).toEqual({ accessToken: "access-token" });
    expect(credentials).not.toHaveProperty("refreshToken");
    expect(credentials).not.toHaveProperty("clientId");
    expect(credentials).not.toHaveProperty("clientSecret");
  });

  it("keeps Bluesky DPoP proof material but not refresh capability in the posting SDK", () => {
    const credentials = buildCredentials(
      account({
        platform: "bluesky",
        tokenMetadata: {
          clientId: "https://simplepost.example/oauth/client-metadata.json",
          dpopPrivateJwk: { d: "private" },
          dpopPublicJwk: { x: "public" },
          pdsUrl: "https://pds.example",
          tokenUrl: "https://auth.example/oauth/token",
        },
      }),
    );

    expect(credentials).toMatchObject({
      accessToken: "access-token",
      did: "platform-user-1",
      dpopPrivateJwk: { d: "private" },
      dpopPublicJwk: { x: "public" },
      pdsUrl: "https://pds.example",
    });
    expect(credentials).not.toHaveProperty("refreshToken");
    expect(credentials).not.toHaveProperty("tokenUrl");
    expect(credentials).not.toHaveProperty("clientId");
  });

  it.each(["instagram", "threads"])("does not let %s refresh independently during publishing", (platform) => {
    const credentials = buildCredentials(account({ platform }));

    expect(credentials).not.toHaveProperty("expiresAt");
    expect(credentials).not.toHaveProperty("refreshToken");
  });
});
