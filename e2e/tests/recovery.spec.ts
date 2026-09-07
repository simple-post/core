import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SchedulerApi, type PostRecord } from "../src/http.js";
import { runScenario } from "../src/run.js";
import { Journal } from "../src/journal.js";
import { catalog, materialize } from "../src/catalog.js";
import { account, config, serve, json } from "./helpers.js";

const since = "2026-01-02T11:55:00.000Z";
function post(index: number): PostRecord {
  const time = new Date(Date.parse("2026-01-02T12:00:00Z") - index * 1000).toISOString();
  return {
    id: `post-${index}`,
    createdAt: time,
    publishedAt: time,
    status: "published",
    message: "unrelated",
    media: [],
    accountIds: ["account-1"],
  };
}
function response(posts: PostRecord[], page: number, total = 105) {
  return {
    posts,
    pagination: {
      page,
      limit: 100,
      total,
      totalPages: Math.ceil(total / 100),
      hasNextPage: page < Math.ceil(total / 100),
      hasPreviousPage: page > 1,
    },
  };
}
for (const duplicate of [false, true])
  test(`receipt recovery scans page two and rejects cross-page matches: duplicate=${duplicate}`, async ({
    page,
    browser,
  }, info) => {
    const savedEnv = {
      E2E_VERIFY_ONLY: process.env.E2E_VERIFY_ONLY,
      E2E_RUN_ID: process.env.E2E_RUN_ID,
      E2E_API_TOKEN: process.env.E2E_API_TOKEN,
    };
    const runDir = await mkdtemp(path.join(os.tmpdir(), "recovery-"));
    const a = account({ observer: { profileUrl: "https://www.threads.com/@testuser", open: [], fields: {} } });
    const cfg = config({ runDir, accounts: { threads: a } });
    const scenario = catalog.find((s) => s.id === "threads.text")!;
    const s = materialize(scenario, a, "ui", "recover", cfg.mediaBaseUrl);
    const posts = Array.from({ length: 105 }, (_, i) => post(i));
    posts[0].createdAt = "2025-01-01T00:00:00Z"; // Old draft published now must not stop recovery before page two.
    for (const index of duplicate ? [99, 100] : [100])
      posts[index] = {
        ...posts[index],
        message: s.message,
        userId: cfg.userId,
        accountOptions: { [a.id]: s.options },
        accountResults: { [a.id]: { accountId: a.id, success: true, postId: `platform-${index}` } },
      };
    const calls: string[] = [];
    const server = await serve((req, res) => {
      calls.push(`${req.method} ${req.url}`);
      const url = new URL(req.url!, "https://test.invalid");
      if (url.pathname === "/api/v1/posts") {
        const page = Number(url.searchParams.get("page"));
        json(res, response(posts.slice((page - 1) * 100, page * 100), page));
      } else json(res, { error: "recovered-receipt-read-sentinel" }, 500);
    });
    cfg.baseUrl = server.url;
    Object.assign(process.env, { E2E_VERIFY_ONLY: "1", E2E_RUN_ID: "recover", E2E_API_TOKEN: "offline-token" });
    try {
      const journal = new Journal(cfg, "recover");
      const entry = await journal.reserve(s, "ui", a);
      entry.phase = "submitting";
      entry.createdAt = since;
      await journal.save(entry);
      await expect(runScenario(cfg, scenario, "ui", page, browser, info)).rejects.toThrow(
        duplicate ? "multiple matching published posts" : "recovered-receipt-read-sentinel",
      );
      const observed = (await journal.get(entry.key))!;
      if (duplicate) {
        expect(observed.receipt).toBeUndefined();
        expect(observed.phase).toBe("submitting");
      } else {
        expect(observed.receipt).toMatchObject({
          simplePostId: "post-100",
          status: "published",
          results: [{ success: true, postId: "platform-100" }],
        });
        expect(observed.phase).toBe("inconclusive");
      }
      expect(calls).toEqual([
        "GET /api/v1/posts?type=past&page=1&limit=100",
        "GET /api/v1/posts?type=past&page=2&limit=100",
        ...(duplicate ? [] : ["GET /api/v1/posts/post-100"]),
      ]);
    } finally {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await server.close();
      await rm(runDir, { recursive: true, force: true });
    }
  });

for (const defect of [
  "missing-pagination",
  "truncated",
  "changed-total",
  "repeated-ID",
  "wrong-order",
  "invalid-time",
  "page-bound",
] as const)
  test(`history recovery fails closed for ${defect}`, async () => {
    const api = new SchedulerApi(config());
    let calls = 0;
    api.request = async <T>() => {
      calls++;
      const rows = Array.from({ length: 100 }, (_, i) => post((calls - 1) * 100 + i));
      const result = response(rows, calls, 3000);
      if (defect === "missing-pagination") delete (result as { pagination?: unknown }).pagination;
      if (defect === "truncated") result.posts.pop();
      if (defect === "changed-total" && calls === 2) result.pagination.total = 2999;
      if (defect === "repeated-ID" && calls === 2) rows[0].id = "post-0";
      if (defect === "wrong-order") rows.reverse();
      if (defect === "invalid-time") rows[0].publishedAt = "invalid";
      return result as T;
    };
    await expect(api.publishedSince("2026-01-01T00:00:00Z")).rejects.toThrow(
      "INCONCLUSIVE: published-history recovery",
    );
    expect(calls).toBe(defect === "page-bound" ? 20 : ["changed-total", "repeated-ID"].includes(defect) ? 2 : 1);
  });

test("history scans every page before filtering the creation window", async () => {
  const api = new SchedulerApi(config());
  let calls = 0;
  api.request = async <T>() => {
    calls++;
    return response(
      Array.from({ length: 100 }, (_, i) => post((calls - 1) * 100 + i)),
      calls,
      1000,
    ) as T;
  };
  expect(await api.publishedSince("2026-01-02T11:59:30Z")).toHaveLength(31);
  expect(calls).toBe(10);
});

test("expected-error attempts without receipts cannot recover an unrelated captionless publication", async ({
  page,
  browser,
}, info) => {
  const savedEnv = { E2E_VERIFY_ONLY: process.env.E2E_VERIFY_ONLY, E2E_RUN_ID: process.env.E2E_RUN_ID };
  const runDir = await mkdtemp(path.join(os.tmpdir(), "negative-recovery-"));
  let reads = 0;
  const server = await serve((_req, res) => {
    reads++;
    json(res, { posts: [] });
  });
  const a = account();
  const cfg = config({ baseUrl: server.url, runDir, accounts: { threads: a } });
  const scenario = catalog.find((s) => s.id === "threads.empty-invalid")!;
  Object.assign(process.env, { E2E_VERIFY_ONLY: "1", E2E_RUN_ID: "negative-recovery" });
  try {
    const journal = new Journal(cfg, "negative-recovery");
    const entry = await journal.reserve(
      materialize(scenario, a, "mcp", "negative-recovery", cfg.mediaBaseUrl),
      "mcp",
      a,
    );
    entry.phase = "submitting";
    await journal.save(entry);
    await expect(runScenario(cfg, scenario, "mcp", page, browser, info)).rejects.toThrow(
      "requires an existing receipt",
    );
    expect(reads).toBe(0);
    expect((await journal.get(entry.key))?.receipt).toBeUndefined();
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await server.close();
    await rm(runDir, { recursive: true, force: true });
  }
});
