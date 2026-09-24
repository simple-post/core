import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { cliCreate } from "../src/adapters/cli.js";
import { configuredAppRoot } from "../src/app-root.js";
import { imageFitCases } from "../src/image-fit-cases.js";
import { materialize } from "../src/catalog.js";
import { mediaFiles } from "../src/media.js";
import { assertFittedBytes } from "../src/verification/image-fit.js";
import { account, config } from "./helpers.js";

for (const mode of ["crop", "blur"] as const)
  for (const input of ["flags", "json"] as const)
    test(`real CLI ${input} ${mode} uploads fitted bytes and preserves its local source`, async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "simplepost-fit-cli-"));
      const a = account();
      const uploads: Buffer[] = [];
      const posts: Array<Record<string, unknown>> = [];
      const server = createServer(async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        };
        try {
          expect(req.headers.authorization).toBe("Bearer fake-scheduler-token");
          if (req.url === "/api/v1/accounts")
            return send(200, { accounts: [{ ...a, platform: "instagram", userId: "user-1" }] });
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const bytes = Buffer.concat(chunks);
          if (req.url === "/api/v1/upload") {
            const form = await new Request("http://localhost/upload", {
              method: "POST",
              headers: { "content-type": req.headers["content-type"]! },
              body: bytes,
            }).formData();
            const file = form.get("file");
            if (!file || typeof file === "string") throw new Error("Missing uploaded file");
            uploads.push(Buffer.from(await file.arrayBuffer()));
            return send(200, {
              url: "https://media.example.com/fitted.jpg",
              filename: "fitted.jpg",
              size: file.size,
              type: "image",
            });
          }
          if (req.url === "/api/v1/posts") {
            const payload = JSON.parse(bytes.toString());
            posts.push(payload);
            return send(200, {
              post: { id: "test-post", status: "published", accountOptions: payload.accountOptions },
              postingResults: [{ accountId: a.id, platform: "instagram", success: true, postId: "12345" }],
            });
          }
          send(404, { error: "Unexpected route" });
        } catch (error) {
          send(500, { error: String(error) });
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No test port");
      const url = `http://127.0.0.1:${address.port}`;
      try {
        const cliDir = path.join(dir, "cli");
        await mkdir(cliDir);
        await writeFile(
          path.join(cliDir, "config.json"),
          JSON.stringify({
            schemaVersion: 1,
            storage: { backend: "file-plain" },
            scheduler: { url, userId: "user-1", connectedAt: "2026-01-01" },
          }),
        );
        await writeFile(
          path.join(cliDir, "secrets.json"),
          JSON.stringify({ schemaVersion: 1, secrets: { "scheduler-token": { token: "fake-scheduler-token" } } }),
        );
        const cfg = config({
          baseUrl: url,
          cliConfigDir: cliDir,
          cliEntry: path.join(configuredAppRoot(), "cli/bin/run.js"),
        });
        const s = materialize(
          { ...imageFitCases.find((s) => s.id === `instagram.fit-portrait-${mode}`)!, input },
          a,
          "cli-app",
          "fit-cli-contract",
          cfg.mediaBaseUrl,
        );
        const media = await mediaFiles(cfg, s.media);
        const source = await readFile(media[0].path);
        await cliCreate(cfg, s, a, media, "cli-app", dir);
        expect(uploads).toHaveLength(1);
        expect(posts).toHaveLength(1);
        expect(posts[0].accountIds).toEqual([a.id]);
        expect(posts[0].media).toEqual([
          expect.objectContaining({ url: "https://media.example.com/fitted.jpg", size: uploads[0].length }),
        ]);
        await assertFittedBytes(uploads[0], source, "fitPortrait", s);
        expect(await readFile(media[0].path)).toEqual(source);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(dir, { recursive: true, force: true });
      }
    });
