import { ForemAuthProvider } from "../../src/lib/auth/forem.js";
import { createEmptyCliConfig } from "../../src/lib/config.js";
import { createSecretStore } from "../../src/lib/secrets.js";
import { getExpectedCliPaths, makeTempHome } from "../helpers.js";

describe("Forem auth", () => {
  afterEach(() => {
    delete (globalThis as any).fetch;
  });

  it("validates and stores an account for a custom Forem instance", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    const provider = new ForemAuthProvider();
    const prompt = { interactive: false, log: jest.fn() } as any;
    const secretStore = createSecretStore(paths, { backend: "file-plain" }, prompt);
    const config = createEmptyCliConfig();
    config.storage = { backend: "file-plain" };

    (globalThis as any).fetch = jest.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 42,
          name: "Alice Example",
          username: "alice",
        }),
        { status: 200 },
      ),
    );

    const nextConfig = await provider.login(
      {
        alias: "main",
        apiKey: "forem-api-key",
        instanceUrl: "https://community.example/",
      },
      { config, paths, prompt, secretStore },
    );

    const account = nextConfig.forem.accounts[0];
    expect(account).toMatchObject({
      alias: "main",
      displayName: "Alice Example",
      settings: { instanceUrl: "https://community.example" },
      userId: "https://community.example#42",
      username: "alice",
    });
    await expect(secretStore.read(account.secretRef)).resolves.toEqual({ accessToken: "forem-api-key" });
    expect((globalThis as any).fetch).toHaveBeenCalledWith(
      "https://community.example/api/users/me",
      expect.objectContaining({
        headers: expect.objectContaining({ "api-key": "forem-api-key" }),
        method: "GET",
      }),
    );
  });

  it("requires an API key in non-interactive mode", async () => {
    const provider = new ForemAuthProvider();

    await expect(
      provider.login(
        { alias: "main" },
        {
          config: createEmptyCliConfig(),
          paths: {} as any,
          prompt: { interactive: false, log: jest.fn() } as any,
          secretStore: {} as any,
        },
      ),
    ).rejects.toThrow(/API key is required/i);
  });
});
