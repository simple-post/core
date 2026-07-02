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
    delete (globalThis as any).fetch;
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
      tokenMetadata: { clientId: "x-client-id" },
    });
    await store.write("x-account-2", {
      accessToken: "stored-access-2",
      expiresAt: 20,
      refreshToken: "stored-refresh-2",
      tokenMetadata: { clientId: "x-client-id" },
    });

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
    expect(postArg.options.x.credentials.clientId).toBe("x-client-id");
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
      tokenMetadata: { clientId: "x-client-id" },
    });
  });

  it("posts through a SimplePost app account non-interactively with --app-account-id", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    const prompt = { interactive: false, log: jest.fn() } as any;

    const config = createEmptyCliConfig();
    config.storage = { backend: "file-plain" };
    config.scheduler = {
      url: "https://schedule.example.com",
      userId: "user-1",
      connectedAt: "2026-01-01T00:00:00.000Z",
    };
    await saveCliConfig(paths, config);

    const store = createSecretStore(paths, { backend: "file-plain" }, prompt);
    await store.write("scheduler-token", { token: "cli-token" });

    (globalThis as any).fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accounts: [
              {
                id: "app-account-1",
                platform: "x",
                platformAccountId: "pa-1",
                username: "alice",
                displayName: "Alice",
                email: null,
                profilePicture: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            post: {},
            postingResults: [{ accountId: "app-account-1", platform: "x", success: true, postId: "post-1" }],
          }),
          { status: 200 },
        ),
      );

    const outputs: string[] = [];
    await runPostWorkflow({
      config: { configDir: paths.configDir } as any,
      flags: {
        "app-account-id": ["app-account-1"],
        text: "hello",
      },
      prompt,
      writeOutput: (message) => outputs.push(message),
    });

    const fetchMock = (globalThis as any).fetch as jest.Mock;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("https://schedule.example.com/api/v1/posts");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer cli-token");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      accountIds: ["app-account-1"],
      message: "hello",
      postingMode: "now",
    });
    expect(outputs[0]).toContain("Succeeded (1)");
    expect(sdk.post).not.toHaveBeenCalled();
  });

  it("rejects --app-account-id when the CLI is not connected to SimplePost", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);

    await expect(
      runPostWorkflow({
        config: { configDir: paths.configDir } as any,
        flags: {
          "app-account-id": ["app-account-1"],
          text: "hello",
        },
        prompt: { interactive: false } as any,
        writeOutput: jest.fn(),
      }),
    ).rejects.toThrow(/simplepost connect/i);
  });

  it("rejects unknown --app-account-id values", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    const prompt = { interactive: false, log: jest.fn() } as any;

    const config = createEmptyCliConfig();
    config.storage = { backend: "file-plain" };
    config.scheduler = {
      url: "https://schedule.example.com",
      userId: "user-1",
      connectedAt: "2026-01-01T00:00:00.000Z",
    };
    await saveCliConfig(paths, config);

    const store = createSecretStore(paths, { backend: "file-plain" }, prompt);
    await store.write("scheduler-token", { token: "cli-token" });

    (globalThis as any).fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accounts: [] }), { status: 200 }));

    await expect(
      runPostWorkflow({
        config: { configDir: paths.configDir } as any,
        flags: {
          "app-account-id": ["missing-account"],
          text: "hello",
        },
        prompt,
        writeOutput: jest.fn(),
      }),
    ).rejects.toThrow(/No SimplePost app account with ID "missing-account"/);
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
