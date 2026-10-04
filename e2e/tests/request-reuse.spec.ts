import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SchedulerApi } from "../src/http.js";
import { config, serve, json } from "./helpers.js";

// Actual Playwright contexts against loopback only; instrumentation counts ownership.
class TrackedApi extends SchedulerApi {
  contexts: APIRequestContext[] = [];
  closes = 0;
  override async context() {
    const context = await request.newContext();
    this.contexts.push(context);
    const dispose = context.dispose.bind(context);
    context.dispose = async () => {
      this.closes++;
      await dispose();
    };
    return context;
  }
}

test("concurrent requests and uploads share one context; external contexts stay caller-owned", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "request-reuse-"));
  const server = await serve((_req, res) => json(res, { ok: true }));
  const api = new TrackedApi({ ...config({ baseUrl: server.url }), readTimeoutMs: 30_000 });
  try {
    const file = path.join(dir, "image.jpg");
    await writeFile(file, "fixture");
    await Promise.all([api.request("/api/one"), api.request("/api/two")]);
    await api.upload({ filename: "image.jpg", path: file, size: 7, sha256: "", url: "", type: "image" });
    expect(api.contexts).toHaveLength(1);
    expect(api.closes).toBe(0);
    const external = await api.context();
    await Promise.all([api.dispose(), api.dispose()]);
    expect(api.closes).toBe(1);
    await expect(api.contexts[0].get(server.url)).rejects.toThrow();
    const response = await external.get(server.url);
    expect(response.ok()).toBe(true);
    await response.dispose();
    await external.dispose();
    await expect(api.request("/api/after-disposal")).rejects.toThrow("disposed");
    expect(api.contexts).toHaveLength(2);
  } finally {
    await api.dispose();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("dispose waits for context creation already in progress", async () => {
  const api = new TrackedApi(config());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const create = api.context.bind(api);
  api.context = async () => {
    await gate;
    return create();
  };
  const operation = api.request("/api/pending").catch(() => undefined);
  const disposal = api.dispose();
  release();
  await Promise.all([operation, disposal]);
  expect(api.contexts).toHaveLength(1);
  expect(api.closes).toBe(1);
});

test("GET uses read timeout while mutations and uploads retain publishing timeout", async () => {
  const calls: string[] = [];
  const server = await serve(async (req, res) => {
    calls.push(req.method!);
    await new Promise((resolve) => setTimeout(resolve, 150));
    json(res, { ok: true });
  });
  const dir = await mkdtemp(path.join(os.tmpdir(), "request-timeout-"));
  const api = new TrackedApi({ ...config({ baseUrl: server.url, publishTimeoutMs: 2000 }), readTimeoutMs: 40 });
  try {
    await expect(api.request("/api/slow")).rejects.toThrow(/timed out|timeout/i);
    await expect(api.request("/api/slow", { method: "POST" })).resolves.toEqual({ ok: true });
    const file = path.join(dir, "image.jpg");
    await writeFile(file, "fixture");
    await expect(
      api.upload({ filename: "image.jpg", path: file, size: 7, sha256: "", url: "", type: "image" }),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["GET", "POST", "POST"]);
  } finally {
    await api.dispose();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
  test(`${method} retries only transient idempotent reads on the same context`, async () => {
    let calls = 0;
    const server = await serve((_req, res) => json(res, { attempt: ++calls }, calls < 3 ? 503 : 200));
    const api = new TrackedApi({ ...config({ baseUrl: server.url }), readTimeoutMs: 30_000 });
    try {
      const result = api.request("/api/retry", { method });
      if (method === "GET") await expect(result).resolves.toEqual({ attempt: 3 });
      else await expect(result).rejects.toThrow("503");
      expect(calls).toBe(method === "GET" ? 3 : 1);
      expect(api.contexts).toHaveLength(1);
    } finally {
      await api.dispose();
      await server.close();
    }
  });
}

test("scoped cleanup runs on success and failure", async () => {
  for (const fail of [false, true]) {
    let owned: SchedulerApi | undefined;
    const result = SchedulerApi.scoped(config(), async (api) => {
      owned = api;
      if (fail) throw new Error("callback failed");
      return "result";
    });
    if (fail) await expect(result).rejects.toThrow("callback failed");
    else await expect(result).resolves.toBe("result");
    await expect(owned!.request("/api/closed")).rejects.toThrow("disposed");
  }
});
