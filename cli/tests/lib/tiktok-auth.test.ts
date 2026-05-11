import { createSecretStore } from "../../src/lib/secrets.js";
import { createEmptyCliConfig } from "../../src/lib/config.js";
import { TikTokAuthProvider } from "../../src/lib/auth/tiktok.js";
import { getExpectedCliPaths, makeTempHome } from "../helpers.js";

describe("TikTok auth", () => {
  afterEach(() => {
    delete process.env.SIMPLE_POST_TIKTOK_CLIENT_ID;
    delete process.env.SIMPLE_POST_TIKTOK_CLIENT_SECRET;
    delete (global as any).fetch;
  });

  it("stores the account from the token response without fetching user info", async () => {
    process.env.SIMPLE_POST_TIKTOK_CLIENT_ID = "tiktok-client-id";
    process.env.SIMPLE_POST_TIKTOK_CLIENT_SECRET = "tiktok-client-secret";

    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    const provider = new TikTokAuthProvider({
      createAccountSecretRef: () => "account-secret-id",
      createState: () => "state-1",
      resolveCallbackUrl: async () =>
        "http://127.0.0.1:5000/oauth/callback?code=provider-code&state=state-1",
    });

    (global as any).fetch = jest.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "access-token",
          expires_in: 86_400,
          open_id: "open-id-1",
          refresh_token: "refresh-token",
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

    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    expect(nextConfig.tiktok.accounts[0]).toMatchObject({
      alias: "main",
      userId: "open-id-1",
    });
    expect(nextConfig.tiktok.accounts[0].username).toBeUndefined();
    await expect(secretStore.read("tiktok-account-account-secret-id")).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenMetadata: {
        clientId: "tiktok-client-id",
      },
    });
  });
});
