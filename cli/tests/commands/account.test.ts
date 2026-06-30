import { spawn } from "node:child_process";
import fs from "node:fs/promises";

import { getExpectedCliPaths, CLI_ROOT, makeTempHome } from "../helpers.js";

describe("account commands", () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.HOME = originalHome;
  });

  it("lists all accounts, filters by platform, and removes accounts", async () => {
    const home = await makeTempHome();
    process.env.HOME = home;
    const paths = getExpectedCliPaths(home);
    await fs.mkdir(paths.configDir, { recursive: true });
    await fs.writeFile(
      paths.configFile,
      JSON.stringify(
        {
          schemaVersion: 1,
          storage: { backend: "file-plain" },
          x: {
            accounts: [
              {
                alias: "main",
                connectedAt: "2026-01-01T00:00:00.000Z",
                secretRef: "x-account-1",
                updatedAt: "2026-01-01T00:00:00.000Z",
                userId: "user-1",
                username: "alice",
              },
            ],
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(
      paths.plainSecretsFile,
      JSON.stringify(
        {
          schemaVersion: 1,
          secrets: {
            "x-account-1": { accessToken: "access", expiresAt: 1, refreshToken: "refresh" },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const allAccountsStdout = await new Promise<string>((resolve, reject) => {
      const child = spawn("node", ["bin/run.js", "account"], {
        cwd: CLI_ROOT,
        env: { ...process.env, HOME: home },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `account failed with exit code ${code}`));
        }
      });
    });

    const xAccountsStdout = await new Promise<string>((resolve, reject) => {
      const child = spawn("node", ["bin/run.js", "account", "x"], {
        cwd: CLI_ROOT,
        env: { ...process.env, HOME: home },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `account x failed with exit code ${code}`));
        }
      });
    });

    expect(allAccountsStdout).toContain("Service");
    expect(allAccountsStdout).toContain("X");
    expect(allAccountsStdout).toContain("@alice");
    expect(xAccountsStdout).toContain("Account");
    expect(xAccountsStdout).toContain("@alice");

    await new Promise<void>((resolve, reject) => {
      const child = spawn("node", ["bin/run.js", "account", "remove", "main"], {
        cwd: CLI_ROOT,
        env: { ...process.env, HOME: home },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr || `account remove failed with exit code ${code}`));
        }
      });
    });

    const configAfterRemove = JSON.parse(await fs.readFile(paths.configFile, "utf8"));
    expect(configAfterRemove.x.accounts).toEqual([]);
  });

  it("renders add help with the account command surface", async () => {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn("node", ["bin/run.js", "account", "add", "--help"], {
        cwd: CLI_ROOT,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(stderr || `account add --help failed with exit code ${code}`));
        }
      });
    });

    expect(stdout).toContain("account add");
    expect(stdout).toContain("--alias");
    expect(stdout).not.toContain("--client-id");
    expect(stdout).not.toContain("--client-secret");
  });
});
