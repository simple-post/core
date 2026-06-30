import { spawn } from "node:child_process";

import { CLI_ROOT } from "../helpers.js";

async function runCli(args: string[]): Promise<{ stderr: string; stdout: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn("node", ["bin/run.js", ...args], {
      cwd: CLI_ROOT,
      env: process.env,
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
        resolve({ stderr, stdout });
      } else {
        reject(new Error(stderr || `${args.join(" ")} failed with exit code ${code}`));
      }
    });
  });
}

describe("post command", () => {
  it("renders help for the post command", async () => {
    const { stdout } = await runCli(["post", "--help"]);

    expect(stdout).toContain("--account");
    expect(stdout).not.toContain("--platforms");
    expect(stdout).not.toContain("--prepare-media");
  });

  it("keeps root help on the top-level command", async () => {
    const { stderr, stdout } = await runCli(["--help"]);

    expect(stderr).not.toContain("compatibility mode enabled");
    expect(stdout).toContain("USAGE");
    expect(stdout).toContain("$ simplepost [COMMAND]");
    expect(stdout).toContain("account");
    expect(stdout).toContain("post");
    expect(stdout).toContain("setup");
    expect(stdout).not.toContain("--account");
  });

  it("still rewrites legacy post flags before help", async () => {
    const { stderr, stdout } = await runCli(["--text", "hello", "--help"]);

    expect(stderr).toContain("compatibility mode enabled");
    expect(stdout).toContain("--account");
    expect(stdout).toContain("--text");
  });
});
