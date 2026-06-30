import { createSecretStore, clearSecretPasswordCache } from "../../src/lib/secrets.js";
import { getExpectedCliPaths, makeTempHome } from "../helpers.js";

describe("secret stores", () => {
  afterEach(() => {
    clearSecretPasswordCache();
    delete process.env.SIMPLE_POST_CONFIG_PASSWORD;
  });

  it("round-trips encrypted secrets with an env password", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    process.env.SIMPLE_POST_CONFIG_PASSWORD = "correct horse battery staple";
    const prompt = {
      interactive: true,
      log: jest.fn(),
      secret: jest.fn(),
    } as any;

    const store = createSecretStore(paths, { backend: "file-encrypted" }, prompt);

    await store.write("secret-1", { value: "hello" });
    await expect(store.read("secret-1")).resolves.toEqual({ value: "hello" });
  });

  it("prompts for a password when the encrypted backend has no env var", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    const prompt = {
      interactive: true,
      log: jest.fn(),
      secret: jest.fn().mockResolvedValue("typed-password"),
    } as any;

    const store = createSecretStore(paths, { backend: "file-encrypted" }, prompt);

    await store.write("secret-1", { value: "hello" });
    expect(prompt.secret).toHaveBeenCalled();
    clearSecretPasswordCache();
    prompt.secret.mockResolvedValue("typed-password");
    await expect(store.read("secret-1")).resolves.toEqual({ value: "hello" });
  });

  it("rejects a wrong encrypted password", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    const prompt = {
      interactive: true,
      log: jest.fn(),
      secret: jest.fn(),
    } as any;

    process.env.SIMPLE_POST_CONFIG_PASSWORD = "password-one";
    const store = createSecretStore(paths, { backend: "file-encrypted" }, prompt);

    await store.write("secret-1", { value: "hello" });
    clearSecretPasswordCache();
    process.env.SIMPLE_POST_CONFIG_PASSWORD = "password-two";

    await expect(store.read("secret-1")).rejects.toThrow(/Failed to decrypt/);
  });

  it("round-trips plaintext secrets", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    const store = createSecretStore(paths, { backend: "file-plain" }, {} as any);

    await store.write("secret-1", { value: "hello" });
    await expect(store.read("secret-1")).resolves.toEqual({ value: "hello" });
    await expect(store.delete("secret-1")).resolves.toBe(true);
    await expect(store.read("secret-1")).resolves.toBeNull();
  });
});
