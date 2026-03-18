import * as secretsModule from "../../src/lib/secrets.js";
import { configureStorage } from "../../src/lib/setup-storage.js";
import { createEmptyCliConfig } from "../../src/lib/config.js";
import { getExpectedCliPaths, makeTempHome } from "../helpers.js";

describe("configureStorage", () => {
  afterEach(() => {
    secretsModule.clearSecretPasswordCache();
    delete process.env.SIMPLE_POST_CONFIG_PASSWORD;
    jest.restoreAllMocks();
  });

  it("migrates secrets from plaintext to encrypted storage", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    const prompt = {
      interactive: true,
      log: jest.fn(),
      secret: jest.fn().mockResolvedValue("migrate-password"),
    } as any;
    process.env.SIMPLE_POST_CONFIG_PASSWORD = "migrate-password";

    const config = createEmptyCliConfig();
    config.storage = { backend: "file-plain" };
    config.x.accounts = [
      {
        alias: "main",
        connectedAt: "2026-01-01T00:00:00.000Z",
        displayName: "Alice",
        secretRef: "x-account-1",
        updatedAt: "2026-01-01T00:00:00.000Z",
        userId: "123",
        username: "alice",
      },
    ];

    const plainStore = secretsModule.createSecretStore(paths, config.storage, prompt);
    await plainStore.write("x-account-1", { accessToken: "token", expiresAt: 1, refreshToken: "refresh" });

    const result = await configureStorage({
      backend: "file-encrypted",
      cliConfig: config,
      paths,
      prompt,
    });

    expect(result.changed).toBe(true);
    expect(result.config.storage).toEqual({
      backend: "file-encrypted",
    });

    const encryptedStore = secretsModule.createSecretStore(paths, result.config.storage!, prompt);
    await expect(encryptedStore.read("x-account-1")).resolves.toEqual({
      accessToken: "token",
      expiresAt: 1,
      refreshToken: "refresh",
    });
  });

  it("reports keychain failures when explicitly selected", async () => {
    jest.spyOn(secretsModule, "probeKeychain").mockResolvedValue({
      available: false,
      message: "No keyring service",
    });

    await expect(
      configureStorage({
        backend: "keychain",
        cliConfig: createEmptyCliConfig(),
        paths: getExpectedCliPaths(await makeTempHome()),
        prompt: { interactive: false } as any,
      }),
    ).rejects.toThrow(/No keyring service/);
  });

  it("supports interactive backend selection through the prompt abstraction", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    const select = jest.fn().mockResolvedValue("file-plain");

    const result = await configureStorage({
      cliConfig: createEmptyCliConfig(),
      paths,
      prompt: {
        interactive: true,
        select,
      } as any,
    });

    expect(result.config.storage?.backend).toBe("file-plain");
    expect(select).toHaveBeenCalledWith(expect.stringContaining("Choose how SimplePost should store account secrets."), expect.any(Array), "keychain");
  });

  it("shows the current backend as the selected default in interactive setup", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    const select = jest.fn().mockResolvedValue("file-encrypted");
    const config = createEmptyCliConfig();
    config.storage = {
      backend: "file-encrypted",
    };

    const result = await configureStorage({
      cliConfig: config,
      paths,
      prompt: {
        interactive: true,
        select,
      } as any,
    });

    expect(result.changed).toBe(false);
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining("Current setting: Encrypted file."),
      expect.arrayContaining([
        expect.objectContaining({
          label: "Encrypted file (current)",
          value: "file-encrypted",
        }),
      ]),
      "file-encrypted",
    );
  });
});
