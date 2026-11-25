import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";

import { CLI_ROOT, createCliTestEnv, getExpectedCliPaths, makeTempHome } from "../helpers.js";

import type { AddressInfo } from "node:net";

function run(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["bin/run.js", ...args], { cwd: CLI_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("analytics commands", () => {
  let server: http.Server;
  const requests: Array<{ url: string; authorization?: string }> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requests.push({ url: req.url ?? "", authorization: req.headers.authorization });
      res.setHeader("Content-Type", "application/json");
      if (req.url?.startsWith("/api/v1/analytics/summary")) {
        res.end(
          JSON.stringify({
            summary: {
              period: { key: "last_7d", start: "2026-11-14T00:00:00Z", end: "2026-11-21T00:00:00Z", timeZone: "UTC" },
              mode: "published",
              totals: { posts: 2, publications: 2, metrics: { views: 100 }, engagements: 7, engagementRate: 0.07 },
              change: null,
              byPlatform: [],
              topPosts: [],
              followers: [],
              bestTimes: { byWeekday: [], byHour: [] },
              coverage: { publications: 2, withData: 2, pending: 0, unavailable: 0, lastUpdatedAt: null },
              notices: [],
            },
          }),
        );
        return;
      }
      if (req.url?.startsWith("/api/v1/posts/post-1/analytics")) {
        res.end(
          JSON.stringify({
            analytics: {
              postId: "post-1",
              publishedAt: null,
              notPublished: false,
              lastUpdatedAt: null,
              totals: { metrics: { likes: 4 }, engagements: 4, engagementRate: null },
              accounts: [],
            },
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("reads summaries and post analytics from the connected SimplePost account", async () => {
    const home = await makeTempHome();
    const env = createCliTestEnv(home);
    const paths = getExpectedCliPaths(home);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await fs.mkdir(paths.configDir, { recursive: true });
    await fs.writeFile(
      paths.configFile,
      JSON.stringify({
        schemaVersion: 1,
        storage: { backend: "file-plain" },
        scheduler: { url, userId: "u1", connectedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await fs.writeFile(
      paths.plainSecretsFile,
      JSON.stringify({ schemaVersion: 1, secrets: { "scheduler-token": { token: "cli-token" } } }),
    );

    const summary = await run(["analytics", "--period", "7d", "--timezone", "UTC", "--platform", "x"], env);
    expect(summary.code).toBe(0);
    expect(summary.stdout).toContain("Analytics · last 7d");
    expect(summary.stdout).toMatch(/Engagements\s+7/);
    const summaryRequest = new URL(requests[0].url, url);
    expect(summaryRequest.searchParams.get("period")).toBe("last_7d");
    expect(summaryRequest.searchParams.get("platform")).toBe("x");
    expect(summaryRequest.searchParams.get("refresh")).toBe("auto");
    expect(requests[0].authorization).toBe("Bearer cli-token");

    const post = await run(["analytics", "post", "post-1", "--json", "--refresh", "none"], env);
    expect(JSON.parse(post.stdout).analytics.totals.engagements).toBe(4);
    expect(requests.at(-1)?.url).toBe("/api/v1/posts/post-1/analytics?refresh=none");

    const invalid = await run(["analytics", "post"], env);
    expect(invalid.code).not.toBe(0);
    expect(invalid.stderr).toContain("Pass either a SimplePost post ID");
  }, 60_000);
});
