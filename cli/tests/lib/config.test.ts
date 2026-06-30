import fs from "node:fs/promises";

import { collectSecretRefs, createEmptyCliConfig, loadCliConfig, saveCliConfig } from "../../src/lib/config.js";
import { getExpectedCliPaths, makeTempHome } from "../helpers.js";

describe("cli config", () => {
  it("returns an empty config when no file exists", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);

    await expect(loadCliConfig(paths)).resolves.toEqual(createEmptyCliConfig());
  });

  it("normalizes legacy config objects without schemaVersion", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    await fs.mkdir(paths.configDir, { recursive: true });
    await fs.writeFile(
      paths.configFile,
      JSON.stringify({
        storage: { backend: "file-encrypted" },
        x: {
          app: {
            clientId: "client-id",
            redirectUri: "http://127.0.0.1:5000/oauth/callback",
            scopes: ["tweet.write"],
            secretRef: "x-app",
          },
          accounts: [
            {
              alias: "main",
              connectedAt: "2026-01-01T00:00:00.000Z",
              secretRef: "secret-1",
              updatedAt: "2026-01-01T00:00:00.000Z",
              userId: "123",
              username: "alice",
            },
          ],
        },
      }),
      "utf8",
    );

    const config = await loadCliConfig(paths);
    expect(config.schemaVersion).toBe(1);
    expect(config.storage).toEqual({
      backend: "file-encrypted",
    });
    expect(config.x.accounts).toHaveLength(1);
  });

  it("saves and reloads config data", async () => {
    const home = await makeTempHome();
    const paths = getExpectedCliPaths(home);
    const config = createEmptyCliConfig();
    config.storage = { backend: "file-plain" };
    config.x.accounts = [
      {
        alias: "main",
        connectedAt: "2026-01-01T00:00:00.000Z",
        secretRef: "secret-1",
        updatedAt: "2026-01-01T00:00:00.000Z",
        userId: "123",
        username: "alice",
      },
    ];

    await saveCliConfig(paths, config);
    await expect(loadCliConfig(paths)).resolves.toEqual(config);
    expect(collectSecretRefs(config)).toEqual(["secret-1"]);
  });
});
