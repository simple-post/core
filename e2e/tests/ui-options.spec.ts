import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setOptions, assertUiPayload, verifyUiThumbnail } from "../src/adapters/ui.js";
import { materialize, catalog } from "../src/catalog.js";
import { account, config, serve } from "./helpers.js";

test("UI album boundary preserves all attachments and rejects reordered mixed media", () => {
  const a = account();
  const s = materialize(
    catalog.find((c) => c.id === "telegram.album-mixed")!,
    a,
    "ui",
    "r",
    "https://media.example.com",
  );
  const payload = {
    accountIds: [a.id],
    message: s.message,
    postingMode: "now",
    media: [{ type: "image" }, { type: "video" }, { type: "image" }],
    accountOptions: { [a.id]: s.options },
  };
  expect(() => assertUiPayload(payload, s, a, "now")).not.toThrow();
  expect(() => assertUiPayload({ ...payload, media: payload.media.slice(0, 1) }, s, a, "now")).toThrow();
  expect(() =>
    assertUiPayload({ ...payload, media: [payload.media[0], payload.media[2], payload.media[1]] }, s, a, "now"),
  ).toThrow();
});

test("UI interaction explicitly persists false even when the initial default is false", async ({ page }) => {
  const a = account();
  const s = materialize(catalog.find((c) => c.id === "tiktok.smoke")!, a, "ui", "r", "https://media.example.com");
  s.options = { autoAddMusic: false };
  await page.setContent(`<button id="account-1-autoAddMusic" role="switch" aria-checked="false"
    onclick="this.setAttribute('aria-checked',String(this.getAttribute('aria-checked')!=='true'));this.dataset.writes=String(Number(this.dataset.writes||0)+1)">Music</button>`);
  await setOptions(page, a, s);
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("switch")).toHaveAttribute("data-writes", "2");
});

test("TikTok UI can explicitly select an empty photo description", async ({ page }) => {
  const a = account();
  const s = materialize(
    catalog.find((c) => c.id === "tiktok.photos-1-music-false-empty")!,
    a,
    "ui",
    "r",
    "https://media.example.com",
  );
  s.options = { description: "" };
  await page.setContent(`<input id="account-1-tiktok-description" value="Post text"><button type="button" id="no-description">No description</button>
    <script>document.querySelector('#no-description').onclick=()=>document.querySelector('#account-1-tiktok-description').value=''</script>`);
  await setOptions(page, a, s);
  await expect(page.locator("#account-1-tiktok-description")).toHaveValue("");
});

test("UI thumbnail uses the file picker and checks uploaded bytes before accepting the generated URL", async ({
  page,
}) => {
  const cfg = config();
  let bytes = await readFile(path.join(cfg.fixtureDir, "image.jpg"));
  const server = await serve((_req, res) => {
    res.writeHead(200, { "content-type": "image/jpeg" });
    res.end(bytes);
  });
  try {
    const a = account();
    const s = materialize(catalog.find((c) => c.id === "youtube.thumbnail")!, a, "ui", "r", cfg.mediaBaseUrl);
    s.options = { thumbnailUrl: s.options.thumbnailUrl };
    await page.setContent(`<input type="file" id="account-1-thumbnail" style="display:none"
      onchange="document.querySelector('img').src='${server.url}/uploaded.jpg'">
      <img alt="YouTube custom thumbnail">`);
    const definition = JSON.stringify(s);
    const submittedOptions = await setOptions(page, a, s, cfg);
    expect(submittedOptions.thumbnailUrl).toBe(`${server.url}/uploaded.jpg`);
    expect(
      JSON.stringify(s),
      "Runtime uploaded URL must not mutate the scenario definition or aggregate signature",
    ).toBe(definition);
    expect(s.expectedFields.thumbnailImage).toBe("image");
    bytes = await readFile(path.join(cfg.fixtureDir, "image-2.jpg"));
    await expect(verifyUiThumbnail(cfg, submittedOptions.thumbnailUrl)).rejects.toThrow("exact original fixture");
  } finally {
    await server.close();
  }
});
for (const visibility of ["PUBLIC", "CONNECTIONS"] as const) {
  test(`LinkedIn UI explicitly persists an already selected ${visibility} default`, async ({ page }) => {
    const a = account();
    const s = materialize(
      catalog.find((s) => s.id === `linkedin.visibility-${visibility.toLowerCase()}`)!,
      a,
      "ui",
      "offline",
      "https://media.example.com",
    );
    const label = visibility === "PUBLIC" ? "Public" : "Connections Only";
    await page.setContent(`<button role="combobox" id="account-1-linkedin-visibility">${label}</button>
      <div id="choices" hidden><div role="option" data-value="PUBLIC">Public</div><div role="option" data-value="CONNECTIONS">Connections Only</div></div>
      <script>window.current='${visibility}';window.changes=[];document.querySelector('button').onclick=()=>document.querySelector('#choices').hidden=false;
      document.querySelectorAll('[role=option]').forEach(option=>option.onclick=()=>{const value=option.dataset.value;if(window.current!==value){window.saved=value;window.changes.push(value)}window.current=value;document.querySelector('button').textContent=option.textContent;document.querySelector('#choices').hidden=true;});</script>`);
    await setOptions(page, a, s);
    const saved = await page.evaluate(() => ({ visibility: (window as any).saved, changes: (window as any).changes }));
    expect(saved).toEqual({ visibility, changes: [visibility === "PUBLIC" ? "CONNECTIONS" : "PUBLIC", visibility] });
    expect(() =>
      assertUiPayload(
        {
          accountIds: [a.id],
          postingMode: "now",
          message: s.message,
          media: [{ type: "image" }],
          accountOptions: { [a.id]: { visibility: saved.visibility } },
        },
        s,
        a,
        "now",
      ),
    ).not.toThrow();
  });
}
