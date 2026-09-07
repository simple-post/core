import { test, expect } from "@playwright/test";
import { waitForDispatch, nextScheduleTime } from "../src/run.js";
import { SchedulerApi } from "../src/http.js";
import { catalog, materialize } from "../src/catalog.js";
import { account, config, serve, json } from "./helpers.js";
test("scheduled path refuses early publication even if API says success", async () => {
  const a = account(),
    cfg = config();
  const s = materialize(catalog.find((c) => c.id === "x.schedule")!, a, "mcp", "r", cfg.mediaBaseUrl);
  s.scheduledFor = new Date(Date.now() + 120_000).toISOString();
  const host = await serve((_req, res) =>
    json(res, {
      post: {
        id: "p",
        message: s.message,
        status: "published",
        accountOptions: { [a.id]: s.options },
        media: [{}],
        accountResults: { [a.id]: { accountId: a.id, success: true, postId: "123" } },
      },
    }),
  );
  process.env.E2E_API_TOKEN = "fake-api-token";
  try {
    await expect(waitForDispatch(new SchedulerApi({ ...cfg, baseUrl: host.url }), "p", s, a, cfg)).rejects.toThrow(
      "Must not publish before",
    );
  } finally {
    delete process.env.E2E_API_TOKEN;
    await host.close();
  }
});
test("scheduled path catches options lost in database/dispatch", async () => {
  const a = account(),
    cfg = config();
  const s = materialize(catalog.find((c) => c.id === "tiktok.schedule")!, a, "mcp", "r", cfg.mediaBaseUrl);
  s.scheduledFor = new Date(Date.now() - 1000).toISOString();
  const host = await serve((_req, res) =>
    json(res, {
      post: {
        id: "p",
        message: s.message,
        status: "published",
        accountOptions: { [a.id]: {} },
        media: [{}],
        accountResults: { [a.id]: { accountId: a.id, success: true, postId: "123" } },
      },
    }),
  );
  process.env.E2E_API_TOKEN = "fake-api-token";
  try {
    await expect(waitForDispatch(new SchedulerApi({ ...cfg, baseUrl: host.url }), "p", s, a, cfg)).rejects.toThrow(
      "Persisted privacyLevel",
    );
  } finally {
    delete process.env.E2E_API_TOKEN;
    await host.close();
  }
});

test("default schedules stay within one to two minutes, including minute and day boundaries", () => {
  const cfg = config();
  expect(cfg.scheduleDelayMinutes).toBe(1);
  for (const timestamp of [
    "2026-09-05T23:10:00.000Z",
    "2026-09-05T23:10:00.001Z",
    "2026-09-05T23:10:59.999Z",
    "2026-09-05T23:59:30.000Z",
  ]) {
    const now = Date.parse(timestamp);
    const scheduled = Date.parse(nextScheduleTime(cfg, now));
    expect(scheduled - now).toBeGreaterThanOrEqual(60_000);
    expect(scheduled - now).toBeLessThanOrEqual(120_000);
    expect(scheduled % 60_000).toBe(0);
  }
});
