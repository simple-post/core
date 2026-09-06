import { test, expect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { cliCreate, checkCliIdentity } from "../src/adapters/cli.js";
import { materialize, catalog } from "../src/catalog.js";
import { platforms, type Platform, type Options } from "../src/types.js";
import { config, account, serve, json } from "./helpers.js";
import { mediaFiles } from "../src/media.js";
const options: Partial<Record<Platform, Options>> = {
  tiktok: {
    privacyLevel: "SELF_ONLY",
    autoAddMusic: false,
    photoCoverIndex: 0,
    allowComment: false,
    title: "A title",
    description: "A caption",
  },
  youtube: {
    privacyStatus: "private",
    selfDeclaredMadeForKids: false,
    categoryId: "22",
    tags: ["test", "video"],
    playlistId: "playlist",
  },
  linkedin: { visibility: "CONNECTIONS" },
  pinterest: {
    boardId: "board",
    title: "Pin title",
    description: "Pin caption",
    link: "https://example.com",
    altText: "Blue photo",
  },
  forem: { title: "Article title", published: false, tags: ["testing"], canonicalUrl: "https://example.com" },
  telegram: { parseMode: "HTML" },
  x: { replyToId: "reply-id" },
};
for (const { platform, caseId } of [
  ...platforms.map((platform) => ({ platform, caseId: `${platform}.smoke` })),
  ...["photos", "videos", "mixed", "mixed-flags"].map((kind) => ({
    platform: "telegram" as const,
    caseId: `telegram.album-${kind}`,
  })),
])
  for (const input of (caseId.includes("album") ? ["flags", "json", "remote"] : ["flags", "json"]) as (
    | "flags"
    | "json"
    | "remote"
  )[]) {
    test(`real CLI ${caseId}: ${input} reaches scheduler with exact options and attachments`, async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "simplepost-cli-e2e-"));
      const a = account();
      const requests: Record<string, unknown>[] = [];
      let uploads = 0;
      const server = await serve((req, res, body) => {
        expect(req.headers.authorization).toBe("Bearer fake-scheduler-token");
        if (req.url === "/api/v1/accounts")
          return json(res, {
            accounts: [{ ...a, platform, userId: "user-1", createdAt: "2026-01-01", updatedAt: "2026-01-01" }],
          });
        if (req.url === "/api/v1/upload") {
          uploads++;
          return json(res, { url: `https://media.example.com/upload-${uploads}`, filename: "image.jpg", size: 123 });
        }
        if (req.url === "/api/v1/posts") {
          const payload = body as Record<string, unknown>;
          requests.push(payload);
          return json(res, {
            post: { id: "post-1", status: "published", accountOptions: payload.accountOptions },
            postingResults: [
              { accountId: a.id, platform, success: true, postId: "12345", postUrl: "https://example.com/post" },
            ],
          });
        }
        json(res, { error: "unknown route" }, 404);
      });
      const cliDir = path.join(dir, "cli");
      await mkdir(cliDir);
      await writeFile(
        path.join(cliDir, "config.json"),
        JSON.stringify({
          schemaVersion: 1,
          storage: { backend: "file-plain" },
          scheduler: { url: server.url, userId: "user-1", connectedAt: "2026-01-01" },
          ...Object.fromEntries(platforms.map((p) => [p, { accounts: [] }])),
        }),
      );
      await writeFile(
        path.join(cliDir, "secrets.json"),
        JSON.stringify({ schemaVersion: 1, secrets: { "scheduler-token": { token: "fake-scheduler-token" } } }),
      );
      const cfg = config({ baseUrl: server.url, cliConfigDir: cliDir });
      const base = catalog.find((c) => c.id === caseId)!;
      const s = materialize(
        { ...base, options: options[platform] ?? {}, input },
        a,
        "cli-app",
        "test",
        "https://media.example.com",
      );
      try {
        await checkCliIdentity(cfg, "cli-app", a, platform);
        const result = await cliCreate(cfg, s, a, await mediaFiles(cfg, s.media), "cli-app", dir);
        expect(result.results[0].postId).toBe("12345");
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
          accountIds: [a.id],
          message: s.message,
          postingMode: "now",
          ...(Object.keys(s.options).length ? { accountOptions: { [a.id]: s.options } } : {}),
        });
        expect(requests[0].idempotencyKey).toBeTruthy();
        expect(JSON.stringify(requests[0])).not.toContain("credentials");
        expect(uploads).toBe(input === "remote" ? 0 : s.media.length);
        expect(((requests[0].media as { type: string; url: string }[]) ?? []).map((m) => m.type)).toEqual(
          s.media.map((key) => (key === "video" || key === "silentVideo" ? "video" : "image")),
        );
        expect(((requests[0].media as { url: string }[]) ?? []).map((m) => m.url)).toEqual(
          input === "remote"
            ? (await mediaFiles(cfg, s.media)).map((m) => m.url)
            : s.media.map((_key, index) => `https://media.example.com/upload-${index + 1}`),
        );
      } finally {
        await server.close();
      }
    });
  }
