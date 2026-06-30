import { getAccountPlatformConfig } from "../../src/lib/account/platforms.js";
import { createEmptyCliConfig, saveCliConfig } from "../../src/lib/config.js";
import { runPostWorkflow } from "../../src/lib/post/run.js";
import { createSecretStore, clearSecretPasswordCache } from "../../src/lib/secrets.js";
import { getExpectedCliPaths, makeTempHome } from "../helpers.js";

jest.mock("@simple-post/sdk", () => ({
  ...jest.requireActual("@simple-post/sdk"),
  post: jest.fn(),
}));

const sdk = jest.requireMock("@simple-post/sdk") as {
  post: jest.Mock;
};

describe("runPostWorkflow", () => {
  afterEach(() => {
    clearSecretPasswordCache();
    sdk.post.mockReset();
    delete process.env.X_API_KEY;
    delete process.env.X_API_SECRET;
    delete process.env.X_ACCESS_TOKEN;
    delete process.env.X_ACCESS_SECRET;
  });

  it("posts to multiple stored X accounts, prints a summary, and persists refreshed credentials", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    const prompt = {
      interactive: false,
      log: jest.fn(),
      secret: jest.fn(),
      text: jest.fn(),
    } as any;

    const config = createEmptyCliConfig();
    config.storage = { backend: "file-plain" };
    config.x.accounts = [
      {
        alias: "main",
        connectedAt: "2026-01-01T00:00:00.000Z",
        secretRef: "x-account-1",
        updatedAt: "2026-01-01T00:00:00.000Z",
        userId: "123",
        username: "alice",
      },
      {
        alias: "backup",
        connectedAt: "2026-01-01T00:00:00.000Z",
        secretRef: "x-account-2",
        updatedAt: "2026-01-01T00:00:00.000Z",
        userId: "456",
        username: "bob",
      },
    ];
    await saveCliConfig(paths, config);

    const store = createSecretStore(paths, { backend: "file-plain" }, prompt);
    await store.write("x-account-1", {
      accessToken: "stored-access",
      expiresAt: 10,
      refreshToken: "stored-refresh",
    });
    await store.write("x-account-2", {
      accessToken: "stored-access-2",
      expiresAt: 20,
      refreshToken: "stored-refresh-2",
    });

    process.env.X_API_KEY = "env-app-key";
    process.env.X_API_SECRET = "env-app-secret";
    process.env.X_ACCESS_TOKEN = "env-access-token";
    process.env.X_ACCESS_SECRET = "env-access-secret";

    sdk.post.mockResolvedValueOnce(
      new Map([
        [
          "x",
          {
            extraData: {
              refreshedCredentials: {
                accessToken: "new-access",
                expiresAt: 99,
                refreshToken: "new-refresh",
              },
            },
            error: "NO_ERROR",
            id: "tweet-1",
          },
        ],
      ]),
    );
    sdk.post.mockResolvedValueOnce(
      new Map([
        [
          "x",
          {
            error: "CREDENTIALS_ERROR",
            message: "Refresh token expired",
          },
        ],
      ]),
    );

    const outputs: string[] = [];
    await expect(
      runPostWorkflow({
        config: { configDir: paths.configDir } as any,
        flags: {
          account: ["x:main", "x:backup"],
          text: "hello",
        },
        prompt,
        writeOutput: (message) => outputs.push(message),
      }),
    ).rejects.toThrow(/X · backup/i);

    expect(sdk.post).toHaveBeenCalledTimes(2);
    const postArg = sdk.post.mock.calls[0][0];
    expect(postArg.options.x.credentials.accessToken).toBe("stored-access");
    expect(postArg.options.x.credentials.clientId).toBe(getAccountPlatformConfig("x").oauthApp!.clientId);
    expect(postArg.options.x.credentials.clientSecret).toBeUndefined();
    const backupPostArg = sdk.post.mock.calls[1][0];
    expect(backupPostArg.options.x.credentials.accessToken).toBe("stored-access-2");
    expect(outputs[0]).toContain("Post summary");
    expect(outputs[0]).toContain("Succeeded (1)");
    expect(outputs[0]).toContain("Failed (1)");
    expect(outputs[0]).toContain("X · main: posted successfully (id: tweet-1)");
    expect(outputs[0]).toContain("X · backup: CREDENTIALS_ERROR - Refresh token expired");
    await expect(store.read("x-account-1")).resolves.toEqual({
      accessToken: "new-access",
      expiresAt: 99,
      refreshToken: "new-refresh",
    });
  });

  it("fails early when posting to X without env credentials or a stored account", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);

    await expect(
      runPostWorkflow({
        config: { configDir: paths.configDir } as any,
        flags: {
          "post-json": JSON.stringify({
            content: {
              text: "hello",
            },
            platforms: ["x"],
          }),
          text: "hello",
        },
        prompt: { interactive: false } as any,
        writeOutput: jest.fn(),
      }),
    ).rejects.toThrow(/no posting targets were selected/i);
  });
});
