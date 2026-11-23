import { TikTokAuthProvider } from "../../src/lib/auth/tiktok.js";
import { createEmptyCliConfig } from "../../src/lib/config.js";
import { CredentialResolver } from "../../src/lib/credentials.js";
import { createSecretStore } from "../../src/lib/secrets.js";
import { getExpectedCliPaths, makeTempHome } from "../helpers.js";

describe("TikTok auth", () => {
  const originalFetch = globalThis.fetch;
  const issuedAt = Math.floor(Date.now() / 1000);

  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(issuedAt * 1000);
    process.env.SIMPLE_POST_TIKTOK_CLIENT_SECRET = "tiktok-client-secret";
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SIMPLE_POST_TIKTOK_CLIENT_ID;
    delete process.env.SIMPLE_POST_TIKTOK_CLIENT_SECRET;
    globalThis.fetch = originalFetch;
  });

  it("stores the account from the token response without fetching user info", async () => {
    process.env.SIMPLE_POST_TIKTOK_CLIENT_ID = "tiktok-client-id";
    process.env.SIMPLE_POST_TIKTOK_CLIENT_SECRET = "tiktok-client-secret";

    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    const provider = new TikTokAuthProvider({
      createAccountSecretRef: () => "account-secret-id",
      createState: () => "state-1",
      resolveCallbackUrl: async () => "http://127.0.0.1:5000/oauth/callback?code=provider-code&state=state-1",
    });

    (globalThis as any).fetch = jest.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "access-token",
          expires_in: 7200,
          open_id: "open-id-1",
          refresh_token: "refresh-token",
          refresh_expires_in: 180 * 86_400,
          scope: "video.upload,video.publish",
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

    expect((globalThis as any).fetch).toHaveBeenCalledTimes(1);
    expect(nextConfig.tiktok.accounts[0]).toMatchObject({
      alias: "main",
      userId: "open-id-1",
    });
    expect(nextConfig.tiktok.accounts[0].username).toBeUndefined();
    await expect(secretStore.read("tiktok-account-account-secret-id")).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: issuedAt + 7200,
      refreshTokenExpiresAt: issuedAt + 180 * 86_400,
      tokenMetadata: {
        clientId: "tiktok-client-id",
      },
    });
  });

  async function savedAccount(overrides: Record<string, unknown> = {}) {
    const paths = getExpectedCliPaths(await makeTempHome());
    const config = createEmptyCliConfig();
    const storage = { backend: "file-plain" } as const;
    const prompt = {} as Parameters<typeof createSecretStore>[2];
    const store = createSecretStore(paths, storage, prompt);
    const account = {
      alias: "main",
      secretRef: "tiktok-account-1",
      userId: "open-id-1",
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    config.tiktok.accounts.push(account);
    await store.write(account.secretRef, {
      accessToken: "first-access",
      expiresAt: issuedAt + 240,
      refreshToken: "first-refresh",
      tokenMetadata: { clientId: "saved-client-id" },
      ...overrides,
    });

    return {
      first: new CredentialResolver(config, store),
      second: new CredentialResolver(config, createSecretStore(paths, storage, prompt)),
      readSecret: () => store.read(account.secretRef),
    };
  }

  it("saves the rotation before posting and shares it with overlapping and later commands", async () => {
    const { first, second, readSecret } = await savedAccount();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("Unexpected extra refresh");
    });
    fetchMock.mockResolvedValueOnce(
      Response.json({
        access_token: "second-access",
        expires_in: 7200,
        refresh_token: "second-refresh",
        refresh_expires_in: 180 * 86_400,
      }),
    );

    const results = await Promise.all([
      first.resolveAccount("tiktok", "main"),
      second.resolveAccount("tiktok", "main"),
    ]);
    for (const result of results) {
      expect(result.postOptions.tiktok?.credentials?.accessToken).toBe("second-access");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(requestBody.get("client_key")).toBe("saved-client-id");
    expect(requestBody.get("refresh_token")).toBe("first-refresh");
    await expect(readSecret()).resolves.toMatchObject({
      accessToken: "second-access",
      expiresAt: issuedAt + 7200,
      refreshToken: "second-refresh",
      refreshTokenExpiresAt: issuedAt + 180 * 86_400,
    });

    jest.mocked(Date.now).mockReturnValue((issuedAt + 7200) * 1000);
    fetchMock.mockResolvedValueOnce(
      Response.json({ access_token: "third-access", expires_in: 7200, refresh_token: "third-refresh" }),
    );
    await second.resolveAccount("tiktok", "main");
    expect((fetchMock.mock.calls[1]?.[1]?.body as URLSearchParams).get("refresh_token")).toBe("second-refresh");
    await expect(readSecret()).resolves.toMatchObject({ refreshToken: "third-refresh" });
  });

  it.each([
    Response.json({ error: "invalid_grant" }, { status: 400 }),
    Response.json({ access_token: "new-access", expires_in: 7200 }),
  ])("offers reauthorization and stops sending a rejected or unusable refresh token", async (response) => {
    const { first, second, readSecret } = await savedAccount();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(response);

    await expect(first.resolveAccount("tiktok", "main")).rejects.toThrow("simplepost account add tiktok --alias main");
    await expect(second.resolveAccount("tiktok", "main")).rejects.toThrow("simplepost account add tiktok --alias main");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(readSecret()).resolves.not.toHaveProperty("refreshToken");
  });

  it("offers reauthorization without submitting a known expired refresh token", async () => {
    const { first } = await savedAccount({ refreshTokenExpiresAt: issuedAt });
    const fetchMock = jest.spyOn(globalThis, "fetch");

    await expect(first.resolveAccount("tiktok", "main")).rejects.toThrow("simplepost account add tiktok --alias main");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
