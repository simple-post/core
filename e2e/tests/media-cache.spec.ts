import { test, expect } from "@playwright/test";
import fs, { mkdtemp, writeFile, rm, stat, utimes, rename, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { createHash } from "node:crypto";
import { mediaFiles, prepareMediaSources } from "../src/media.js";
import { SchedulerApi } from "../src/http.js";
import { config, serve, json } from "./helpers.js";

const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

test("local metadata is reused concurrently without retaining mutable URLs or results", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "media-cache-"));
  const original = fs.open;
  let opens = 0;
  try {
    await writeFile(path.join(dir, "image.jpg"), "image");
    await writeFile(path.join(dir, "video.mp4"), "video");
    fs.open = (async (...args: Parameters<typeof fs.open>) => {
      opens++;
      return original(...args);
    }) as typeof fs.open;
    syncBuiltinESMExports();
    const cfg = config({ fixtureDir: dir });
    const [first, second] = await Promise.all([
      mediaFiles(cfg, ["image", "video"]),
      mediaFiles(cfg, ["image", "video"]),
    ]);
    expect(opens).toBe(2);
    first[0].sha256 = "mutated";
    expect(second[0].sha256).toBe(hash("image"));
    cfg.fixtureUrls["image.jpg"] = "https://another.example/thumbnail.jpg";
    cfg.fixtureUrls["video.mp4"] = "https://another.example/video.mp4";
    const changed = await mediaFiles(cfg, ["image", "video"]);
    expect(changed[0].url).toBe(cfg.fixtureUrls["image.jpg"]);
    expect(changed[1].thumbnailUrl).toBe(cfg.fixtureUrls["image.jpg"]);
    expect(changed[1].url).toBe(cfg.fixtureUrls["video.mp4"]);
    expect(changed[0].sha256).toBe(hash("image"));
    expect(opens).toBe(2);
  } finally {
    fs.open = original;
    syncBuiltinESMExports();
    await rm(dir, { recursive: true, force: true });
  }
});

test("cache invalidates on size, mtime, same-size replacement, deletion and different fixture roots", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "media-invalidation-"));
  const other = await mkdtemp(path.join(os.tmpdir(), "media-other-"));
  const file = path.join(dir, "image.jpg");
  const cfg = config({ fixtureDir: dir });
  const check = async (bytes: string) => {
    const [result] = await mediaFiles(cfg, ["image"]);
    expect(result.sha256).toBe(hash(bytes));
    expect(result.size).toBe(Buffer.byteLength(bytes));
  };
  try {
    await writeFile(file, "first");
    await check("first");
    await writeFile(file, "longer second");
    await check("longer second");
    const saved = await stat(file);
    await writeFile(file, "same size now");
    await utimes(file, saved.atime, new Date(saved.mtimeMs + 2000));
    await check("same size now");
    const replacement = path.join(dir, "replacement");
    const previous = await stat(file);
    await writeFile(replacement, "replacement!!");
    await utimes(replacement, previous.atime, previous.mtime);
    await rename(replacement, file);
    await check("replacement!!");
    // In-place changes with restored mtime must also invalidate (ctime differs).
    await writeFile(file, "another value");
    await utimes(file, previous.atime, previous.mtime);
    await check("another value");
    await rm(file);
    await expect(mediaFiles(cfg, ["image"])).rejects.toThrow(/ENOENT/);
    await writeFile(file, "recreated");
    await check("recreated");
    await writeFile(path.join(other, "image.jpg"), "other");
    expect((await mediaFiles(config({ fixtureDir: other }), ["image"]))[0].sha256).toBe(hash("other"));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  }
});

test("preflight deduplicates assets, writes an atomic manifest, and still verifies remote bytes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "media-stage-"));
  let uploads = 0;
  let checks = 0;
  let remote = "fixture";
  const server = await serve((req, res, body) => {
    if (req.method === "POST") {
      expect(req.url).toBe("/api/v1/upload");
      expect(String(body)).toContain("fixture");
      uploads++;
      json(res, { url: `${server.url}/image.jpg`, size: 7 });
    } else {
      checks++;
      res.end(remote);
    }
  });
  const cfg = config({
    fixtureDir: dir,
    baseUrl: server.url,
    mediaBaseUrl: "https://fixtures.invalid/",
    mediaManifestFile: path.join(dir, "manifest.json"),
    apiTokenEnv: "MEDIA_CACHE_TEST_TOKEN",
  });
  const old = process.env.MEDIA_CACHE_TEST_TOKEN;
  process.env.MEDIA_CACHE_TEST_TOKEN = "offline";
  const api = new SchedulerApi(cfg);
  try {
    await writeFile(path.join(dir, "image.jpg"), "fixture");
    const files = await prepareMediaSources(cfg, ["image", "image"], api);
    expect(files).toHaveLength(1);
    expect(uploads).toBe(1);
    expect(checks).toBe(1);
    expect(JSON.parse(await readFile(cfg.mediaManifestFile!, "utf8"))).toEqual({
      baseUrl: cfg.baseUrl,
      userId: cfg.userId,
      urls: cfg.fixtureUrls,
    });
    expect((await readdir(dir)).filter((file) => file.endsWith(".tmp"))).toEqual([]);
    remote = "changed";
    await expect(prepareMediaSources(cfg, ["image"], api)).rejects.toThrow("does not match");
    expect(uploads).toBe(1);
    expect(checks).toBe(2);
  } finally {
    await api.dispose();
    if (old === undefined) delete process.env.MEDIA_CACHE_TEST_TOKEN;
    else process.env.MEDIA_CACHE_TEST_TOKEN = old;
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
