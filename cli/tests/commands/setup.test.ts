import { spawn } from "node:child_process";
import fs from "node:fs/promises";

import { getExpectedCliPaths, CLI_ROOT, makeTempHome } from "../helpers.js";

describe("setup command", () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("supports non-interactive backend selection", async () => {
    const home = await makeTempHome();
    process.env.HOME = home;
    const paths = getExpectedCliPaths(home);

    await new Promise<void>((resolve, reject) => {
      const child = spawn("node", ["bin/run.js", "setup", "--backend", "file-plain"], {
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
          reject(new Error(stderr || `setup failed with exit code ${code}`));
        }
      });
    });

    await expect(fs.readFile(paths.configFile, "utf8")).resolves.toContain('"backend": "file-plain"');
  });
});
