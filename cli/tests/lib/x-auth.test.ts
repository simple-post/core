import { getAccountPlatformConfig } from "../../src/lib/account/platforms.js";
import { resolveOAuthAppInputs } from "../../src/lib/auth/oauth.js";
import {
  XAuthProvider,
  generatePkcePair,
  parseOAuthCallbackUrl,
  resolveXAlias,
  resolveXCallbackUrl,
} from "../../src/lib/auth/x.js";
import { createEmptyCliConfig } from "../../src/lib/config.js";
import { createSecretStore } from "../../src/lib/secrets.js";
import { getExpectedCliPaths, makeTempHome } from "../helpers.js";

describe("X auth helpers", () => {
  afterEach(() => {
    delete process.env.SIMPLE_POST_OAUTH_TIMEOUT_MS;
    delete process.env.SIMPLE_POST_X_CLIENT_ID;
    delete (globalThis as any).fetch;
  });

  it("generates a PKCE verifier and challenge", async () => {
    const { codeChallenge, codeVerifier } = await generatePkcePair();
    expect(codeChallenge).toBeTruthy();
    expect(codeVerifier).toBeTruthy();
    expect(codeChallenge).not.toEqual(codeVerifier);
  });

  it("validates callback state", () => {
    expect(() =>
      parseOAuthCallbackUrl(
        "http://127.0.0.1:5000/oauth/callback?code=abc&state=wrong",
        "expected",
        "http://127.0.0.1:5000/oauth/callback",
      ),
    ).toThrow(/state validation failed/i);
  });

  it("rejects duplicate aliases for another user", async () => {
    await expect(
      resolveXAlias(
        { interactive: false } as any,
        [
          {
            alias: "main",
            connectedAt: "2026-01-01T00:00:00.000Z",
            secretRef: "secret-1",
            updatedAt: "2026-01-01T00:00:00.000Z",
            userId: "other",
            username: "alice",
          },
        ],
        "user-1",
        "bob",
        "main",
      ),
    ).rejects.toThrow(/already stored/i);
  });

  it("falls back to a pasted callback URL after the loopback listener times out", async () => {
    process.env.SIMPLE_POST_OAUTH_TIMEOUT_MS = "10";
    const config = createEmptyCliConfig();

    const callbackUrl = await resolveXCallbackUrl(
      {
        config,
        paths: {} as any,
        prompt: {
          interactive: true,
          log: jest.fn(),
          text: jest.fn().mockResolvedValue("http://127.0.0.1:59991/oauth/callback?code=abc&state=expected"),
        } as any,
        secretStore: {} as any,
      },
      {
        noBrowser: true,
      },
      "https://x.com/i/oauth2/authorize?state=expected",
      "http://127.0.0.1:59991/oauth/callback",
    );

    expect(callbackUrl).toContain("code=abc");
  });

  it("requires the client ID environment variable", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    const provider = new XAuthProvider();
    const prompt = { interactive: false, log: jest.fn() } as any;
    const config = createEmptyCliConfig();
    config.storage = { backend: "file-plain" };

    await expect(
      provider.login(
        { alias: "main" },
        {
          config,
          paths,
          prompt,
          secretStore: createSecretStore(paths, { backend: "file-plain" }, prompt),
        },
      ),
    ).rejects.toThrow(/SIMPLE_POST_X_CLIENT_ID/);
  });

  it("applies the shared callback-port override to the default redirect URI", () => {
    process.env.SIMPLE_POST_X_CLIENT_ID = "x-client-id";

    const resolved = resolveOAuthAppInputs("x", { callbackPort: 6123 }, getAccountPlatformConfig("x").oauthApp!);

    expect(resolved.redirectUri).toBe("http://127.0.0.1:6123/oauth/callback");
  });

  it("logs in successfully through the provider", async () => {
    process.env.SIMPLE_POST_X_CLIENT_ID = "x-client-id";
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    const provider = new XAuthProvider({
      createAccountSecretRef: () => "account-secret-id",
      createState: () => "state-1",
      resolveCallbackUrl: async () => "http://127.0.0.1:5000/oauth/callback?code=provider-code&state=state-1",
    });

    (globalThis as any).fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access-token",
            expires_in: 3600,
            refresh_token: "refresh-token",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "user-1",
              name: "Alice",
              username: "alice",
            },
          }),
          { status: 200 },
        ),
      );

    const prompt = {
      interactive: false,
      log: jest.fn(),
    } as any;
    const secretStore = createSecretStore(paths, { backend: "file-plain" }, prompt);
    const config = createEmptyCliConfig();
    config.storage = { backend: "file-plain" };

    const nextConfig = await provider.login(
      {
        alias: "main",
      },
      {
        config,
        paths,
        prompt,
        secretStore,
      },
    );

    expect(nextConfig.x.accounts[0].alias).toBe("main");
    await expect(secretStore.read("x-account-account-secret-id")).resolves.toEqual({
      accessToken: "access-token",
      expiresAt: expect.any(Number),
      refreshToken: "refresh-token",
      tokenMetadata: {
        clientId: "x-client-id",
      },
    });

    const firstFetchCall = (globalThis as any).fetch.mock.calls[0];
    expect(firstFetchCall[1].headers.Authorization).toBeUndefined();
    expect(firstFetchCall[1].body.get("client_id")).toBe("x-client-id");
  });
});
