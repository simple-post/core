import { test, expect } from "@playwright/test";
import { uiCreate, UiSubmissionBlockedError } from "../src/adapters/ui.js";
import { materialize, catalog } from "../src/catalog.js";
import { mediaFiles } from "../src/media.js";
import { account, config, serve, json } from "./helpers.js";

for (const kind of ["poster", "video", "failed", "missing-payload"] as const) {
  test(`UI waits for completed video uploads: ${kind}`, async ({ page }) => {
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let submissions = 0;
    let submitting = false;
    const a = account();
    const cfg = config({ publishTimeoutMs: kind === "failed" ? 700 : 5000 });
    const s = materialize(catalog.find((c) => c.id === "telegram.video")!, a, "ui", "r", cfg.mediaBaseUrl);
    // Duplicate filenames must wait for every copy, not just the first preview.
    s.media = ["video", "video"];
    const server = await serve(async (req, res, body) => {
      if (req.url === "/upload" || req.url === "/upload/second") {
        await (req.url === "/upload" ? uploadGate : secondGate);
        return json(res, {});
      }
      if (req.method === "POST") {
        submissions++;
        expect((body as { media: unknown[] }).media).toHaveLength(2);
        return json(res, { post: { id: "post-1", status: "published" } });
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<form onsubmit="event.preventDefault(); window.clicked=true; fetch('/api/v1/posts', {method:'POST', body:JSON.stringify({accountIds:['account-1'],postingMode:'now',message:document.querySelector('textarea').value,media:window.media||[]})}).catch(()=>{})">
        <label>Message<textarea></textarea></label>
        <button type="button" disabled>Clear all</button>
        <button type="button" data-testid="account-toggle-telegram-account-1">Telegram</button>
        <input type="file" multiple>
        <div id="cards"></div>
        <button type="button" id="post-now">Now</button>
        <button type="submit">Post</button>
      </form><script>
        document.querySelector('input').onchange=async()=>{
          document.querySelector('#cards').innerHTML='<div><p>video.mp4</p><span>30%</span></div>';
          await fetch('/upload');
          if (${JSON.stringify(kind)} === 'failed') return;
          const preview = ${JSON.stringify(kind)} === 'video' ? '<video src="/video.mp4"></video>' : '<img alt="video.mp4" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">';
          const card='<div class="relative group">'+preview+'<p>video.mp4</p><button type="button">Remove</button></div>';
          document.querySelector('#cards').innerHTML=card;
          // A partial batch is not ready either.
          await fetch('/upload/second');
          document.querySelector('#cards').innerHTML+=card;
          window.media=${JSON.stringify(kind)} === 'missing-payload' ? [] : [{type:'video'},{type:'video'}];
        };
      </script>`);
    });
    cfg.baseUrl = server.url;
    let outcome: Awaited<ReturnType<typeof uiCreate>> | Error | undefined;
    try {
      const operation = uiCreate(page, cfg, s, a, await mediaFiles(cfg, s.media), async () => {
        submitting = true;
      }).then(
        (receipt) => {
          outcome = receipt;
        },
        (error: Error) => {
          outcome = error;
        },
      );
      await expect(page.getByText("30%", { exact: true })).toBeVisible();
      expect(submitting).toBe(false);
      expect(submissions).toBe(0);
      expect(await page.evaluate(() => (window as unknown as { clicked?: boolean }).clicked)).toBeUndefined();
      releaseUpload();
      if (kind !== "failed") {
        await expect(page.locator("form div.relative.group")).toHaveCount(1);
        expect(submitting).toBe(false);
        expect(submissions).toBe(0);
      }
      releaseSecond();
      await operation;
      if (kind === "failed") {
        expect(outcome).toBeInstanceOf(Error);
        expect((outcome as Error).message).toContain("completed upload");
        expect(submitting).toBe(false);
        expect(submissions).toBe(0);
      } else if (kind === "missing-payload") {
        expect(outcome).toBeInstanceOf(UiSubmissionBlockedError);
        expect((outcome as Error).message).toContain("UI attachment count");
        expect(submissions).toBe(0);
      } else {
        expect(outcome).toMatchObject({ simplePostId: "post-1" });
        expect(submissions).toBe(1);
      }
    } finally {
      releaseUpload();
      releaseSecond();
      await server.close();
    }
  });
}
