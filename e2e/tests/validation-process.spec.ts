import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { configuredAppRoot } from "../src/app-root.js";
import { platforms } from "../src/types.js";
import { validationCases } from "../src/validation-cases.js";
import { materialize } from "../src/catalog.js";
import { mediaFiles } from "../src/media.js";
import { account, config } from "./helpers.js";

// Exercise shipped artifacts and the real CLI parser in a fresh process. No
// validator, publisher, media decoder, or probe is replaced. The network tripwire
// records and blocks *any* socket attempt, including swallowed/fallback failures.
const guard = `
const fs = require('node:fs');
const net = require('node:net');
net.Socket.prototype.connect = function () {
 fs.appendFileSync(process.env.VALIDATION_NETWORK_LOG, 'attempt\\n');
 throw Error('Unexpected network access in validation regression');
};
`;
const sdkRunner = `
const {createRequire} = require('node:module');
const fs = require('node:fs');
const sdk = createRequire(process.env.VALIDATION_APP_MANIFEST)('@simple-post/sdk');
(async () => {
 const post = JSON.parse(fs.readFileSync(process.env.VALIDATION_POST_FILE, 'utf8'));
 const results = await sdk.post(post);
 console.log(JSON.stringify(results.get(post.platforms[0])));
})().catch(() => { process.exitCode = 1; });
`;
for (const scenario of validationCases) {
  test(`publishing validation: ${scenario.id} blocks SDK and real CLI before network access`, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "simplepost-validation-e2e-"));
    const root = configuredAppRoot();
    try {
      const s = materialize(scenario, account(), "cli-local", "offline", "https://fixtures.invalid");
      const files = await mediaFiles(config(), s.media);
      const post = {
        platforms: [s.platform],
        content: {
          text: s.message,
          // Lie about size, MIME and duration to ensure inspection uses bytes.
          media: files.map((file) => ({
            type: file.type,
            path: file.path,
            size: 1,
            contentType: file.type === "video" ? "video/mp4" : "image/jpeg",
            ...(file.type === "video" ? { durationSec: 4 } : {}),
          })),
        },
        options: {
          common: { logLevel: "none" },
          [s.platform]: {
            ...s.options,
          },
        },
      };
      const postFile = path.join(dir, "post.json"),
        guardFile = path.join(dir, "guard.cjs");
      const networkLog = path.join(dir, "network.log");
      await writeFile(postFile, JSON.stringify(post));
      await writeFile(guardFile, guard);
      await writeFile(networkLog, "");
      await writeFile(
        path.join(dir, "config.json"),
        JSON.stringify({
          schemaVersion: 1,
          storage: { backend: "file-plain" },
          ...Object.fromEntries(
            platforms.map((platform) => [
              platform,
              {
                accounts: [
                  {
                    alias: "test",
                    userId: "1",
                    connectedAt: "2026-01-01",
                    updatedAt: "2026-01-01",
                    secretRef: "fake",
                  },
                ],
              },
            ]),
          ),
        }),
      );
      await writeFile(
        path.join(dir, "secrets.json"),
        JSON.stringify({
          schemaVersion: 1,
          secrets: {
            fake: {
              accessToken: "fake",
              refreshToken: "fake",
              expiresAt: 4102444800,
              tokenMetadata: { clientId: "fake", pdsUrl: "https://pds.invalid" },
            },
          },
        }),
      );
      const env = {
        PATH: process.env.PATH,
        SYSTEMROOT: process.env.SYSTEMROOT,
        HOME: dir,
        XDG_CONFIG_HOME: dir,
        SIMPLEPOST_CONFIG_DIR: dir,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        VALIDATION_NETWORK_LOG: networkLog,
        VALIDATION_POST_FILE: postFile,
        VALIDATION_APP_MANIFEST: path.join(root, "package.json"),
      };
      const sdk = await promisify(execFile)(process.execPath, ["--require", guardFile, "-e", sdkRunner], {
        cwd: root,
        env,
        timeout: 20_000,
        maxBuffer: 1_000_000,
      });
      const result = JSON.parse(sdk.stdout.trim());
      expect(result.error).toBe("INVALID_CONTENT");
      expect(result.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ...s.expectedIssue,
            severity: "error",
            platform: s.platform,
          }),
        ]),
      );
      expect(result.id).toBeUndefined();
      expect(await readFile(networkLog, "utf8")).toBe("");
      let cli: { code?: number | string; stdout: string; stderr: string };
      try {
        cli = {
          code: 0,
          ...(await promisify(execFile)(
            process.execPath,
            [
              "--require",
              guardFile,
              path.join(root, "cli/bin/run.js"),
              "post",
              "--account",
              `${s.platform}:test`,
              "--post-json",
              postFile,
              "--log-level",
              "none",
            ],
            { cwd: root, env, timeout: 20_000, maxBuffer: 1_000_000 },
          )),
        };
      } catch (error) {
        cli = error as typeof cli;
      }
      expect(cli.code).toBe(1);
      const output = cli.stdout + cli.stderr;
      expect(output).toContain("INVALID_CONTENT");
      expect(output).toMatch(new RegExp(s.expectedError!, "i"));
      expect(output).not.toMatch(/\(id: /);
      expect(await readFile(networkLog, "utf8")).toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
