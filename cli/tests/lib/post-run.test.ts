import { writeFile } from "node:fs/promises";
import path from "node:path";

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
  it("passes a local Bluesky video and stored credentials to the SDK", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    const prompt = { interactive: false, log: jest.fn() } as any;
    const config = createEmptyCliConfig();
    config.storage = { backend: "file-plain" };
    config.bluesky.accounts = [
      {
        alias: "main",
        connectedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        secretRef: "bsky-1",
        userId: "did:plc:user",
        username: "alice.bsky.social",
      },
    ];
    await saveCliConfig(paths, config);
    await createSecretStore(paths, { backend: "file-plain" }, prompt).write("bsky-1", {
      accessToken: "token",
      tokenMetadata: { pdsUrl: "https://bsky.social", clientId: "https://app.example.com/client-metadata.json" },
    });
    const videoPath = path.join(home, "video.mp4");
    await writeFile(videoPath, "video fixture");
    sdk.post.mockResolvedValueOnce(
      new Map([["bluesky", { error: "NO_ERROR", id: "at://did:plc:user/app.bsky.feed.post/video" }]]),
    );
    await runPostWorkflow({
      config: { configDir: paths.configDir } as any,
      flags: { account: ["bluesky:main"], video: [videoPath], text: "Demo" },
      prompt,
      writeOutput: jest.fn(),
    });
    expect(sdk.post).toHaveBeenCalledWith(
      expect.objectContaining({
        platforms: ["bluesky"],
        content: expect.objectContaining({ media: [expect.objectContaining({ type: "video", path: videoPath })] }),
        options: expect.objectContaining({
          bluesky: expect.objectContaining({
            credentials: expect.objectContaining({ did: "did:plc:user", accessToken: "token" }),
          }),
        }),
      }),
    );
  });
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
      idempotencyKey: expect.any(String),
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

it.each(["public", "draft"])(
  "forwards TikTok photo options and uploads local files for app-connected %s",
  async (publishMode) => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    const prompt = { interactive: false, log: jest.fn() } as any;
    const config = createEmptyCliConfig();
    config.storage = { backend: "file-plain" };
    config.scheduler = { url: "https://schedule.example.com", userId: "user-1", connectedAt: "2026-01-01T00:00:00Z" };
    await saveCliConfig(paths, config);
    const store = createSecretStore(paths, { backend: "file-plain" }, prompt);
    await store.write("scheduler-token", { token: "cli-token" });
    const localPhoto = path.join(home, "photo.jpg");
    await writeFile(localPhoto, Buffer.from([255, 216, 255, 217]));
    const settings = {
      publishMode,
      autoAddMusic: publishMode === "public",
      ...(publishMode === "public" ? { privacyLevel: "SELF_ONLY" } : {}),
      photoCoverIndex: 0,
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accounts: [{ id: "tt", platform: "tiktok", username: "creator" }] })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: "https://media.example.com/local.jpg", filename: "photo.jpg", size: 4 })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            post: {},
            postingResults: [
              {
                accountId: "tt",
                platform: "tiktok",
                success: true,
                postId: "p_pub_url~123",
                message: publishMode === "draft" ? "Uploaded to TikTok inbox. Publish manually." : undefined,
              },
            ],
          }),
        ),
      );
    (globalThis as any).fetch = fetchMock;
    const outputs: string[] = [];
    await runPostWorkflow({
      config: { configDir: paths.configDir } as any,
      prompt,
      writeOutput: (message) => outputs.push(message),
      flags: {
        "app-account-id": ["tt"],
        image: [localPhoto, "https://media.example.com/second.jpg"],
        text: "Carousel",
        "options-json": JSON.stringify({ tiktok: { ...settings, credentials: { accessToken: "must-not-be-sent" } } }),
      },
    });
    expect(fetchMock.mock.calls[1][0]).toBe("https://schedule.example.com/api/v1/upload");
    expect(fetchMock.mock.calls[1][1].body.get("file").name).toBe("photo.jpg");
    const body = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(body.accountOptions).toEqual({ tt: settings });
    expect(body.postingMode).toBe("now");
    expect(body.media.map((item: { url: string }) => item.url)).toEqual([
      "https://media.example.com/local.jpg",
      "https://media.example.com/second.jpg",
    ]);
    expect(JSON.stringify(body)).not.toContain("must-not-be-sent");
    if (publishMode === "draft") expect(outputs[0]).toContain("Publish manually");
    delete (globalThis as any).fetch;
  },
);
