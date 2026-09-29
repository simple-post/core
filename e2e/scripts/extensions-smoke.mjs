// Local host bridge: exercises production widget bundles without database or social writes.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { chromium, expect } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scheduler");
const manifest = await readFile(path.join(root, "lib/mcp/ui/widget-assets.ts"), "utf8");
const assets = runInNewContext(`(${manifest.split("= ")[1].split(" as const")[0]})`);
const account = (platform) => ({
  accountId: platform,
  platform,
  displayName: `Test ${platform}`,
  username: "simplepost",
  profilePicture: null,
  credentialStatus: { message: "Connected" },
});
const workspace = {
  kind: "workspace",
  preferences: {
    timeZone: "Europe/Berlin",
    timeZoneConfirmed: true,
    calendarView: "day",
    defaultAccountIds: ["x", "linkedin"],
  },
  accounts: [
    "x",
    "linkedin",
    "bluesky",
    "instagram",
    "facebook",
    "threads",
    "youtube",
    "tiktok",
    "pinterest",
    "telegram",
    "forem",
  ].map(account),
  accountsUrl: "https://app.simplepost.social/accounts?onboarding=connect",
  canWrite: true,
  canValidate: true,
  imageFittingEnabled: false,
  posts: { status: "drafts", posts: [], pagination: null },
  recovery: [],
  schedule: {
    kind: "schedule",
    view: "day",
    anchorDate: "2026-09-29",
    previousAnchorDate: "2026-09-28",
    nextAnchorDate: "2026-09-30",
    todayAnchorDate: "2026-09-29",
    timeZone: "Europe/Berlin",
    periodLabel: "Tuesday, 29 September",
    rangeStart: "2026-09-28T22:00:00Z",
    rangeEnd: "2026-09-29T22:00:00Z",
    days: [
      {
        date: "2026-09-29",
        weekday: "Tuesday",
        weekdayShort: "Tue",
        dayNumber: 29,
        inPeriod: true,
        isToday: true,
        entries: [
          {
            id: "slot",
            kind: "slot",
            at: "2026-09-29T14:30:00Z",
            localTime: "16:30",
            isPast: false,
            postId: null,
            message: null,
            status: "open",
            platforms: [],
            errorMessage: null,
          },
        ],
      },
    ],
    summary: { openSlotCount: 1, scheduledCount: 0, publishedCount: 0, failedCount: 0, pastCount: 0 },
  },
};
const fixture = `
const launch = ${JSON.stringify(workspace)};
if (location.search.includes('onboarding')) launch.accounts=[];
if (location.search.includes('readonly')) { launch.canWrite=false; launch.canValidate=false; }
window.calls=[]; window.contexts=[]; window.messages=[]; window.links=[];
let session={kind:'editor',sessionId:'3e07953d-c01f-4a95-baf0-20b597ff9373',postId:null,revision:0,baseUpdatedAt:null,committing:false,proposal:null,status:'new',scheduledFor:null,content:{message:'',accountIds:launch.preferences.defaultAccountIds,media:[],thread:[],accountOptions:{},accountOverrides:{},quotePostId:null}};
window.propose=(patch)=>{ session={...session,proposal:{patch,explanation:'Shorter proposed text',revision:session.revision}}; document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{content:[],structuredContent:session}},'*'); };
window.removeSelection=()=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{'openai/modelContext':null}},'*');
window.addEventListener('message', async event => {
 const req=event.data; if(req.jsonrpc!=='2.0') return;
 const send=(result)=>event.source.postMessage({jsonrpc:'2.0',id:req.id,result},'*');
 if(req.method==='ui/initialize') send({protocolVersion:req.params.protocolVersion,hostInfo:{name:'SimplePost smoke host',version:'1'},hostCapabilities:{serverTools:{},openLinks:{},updateModelContext:{text:{},structuredContent:{}},message:{text:{}}},hostContext:{theme:'dark',displayMode:'fullscreen',availableDisplayModes:['fullscreen']}});
 else if(req.method==='ui/notifications/initialized') event.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{content:[],structuredContent:launch}},'*');
 else if(req.method==='tools/call') {
   const {name,arguments:args}=req.params; window.calls.push({name,args}); let result;
   if(name==='start_post_editor_session'||name==='read_post_editor_session') result=session;
   else if(name==='update_post_editor_session') { if(args.expectedRevision!==session.revision) throw Error('stale'); session={...session,content:args.content,revision:session.revision+1,proposal:null}; result=session; }
   else if(name==='get_simplepost_workspace') result={...launch,recovery:[{id:session.sessionId,postId:session.postId,message:session.content.message,updatedAt:new Date().toISOString(),revision:session.revision,committing:false}]};
   else if(name==='commit_post_editor_session') { session={...session,postId:'saved',status:args.mode==='draft'?'draft':'scheduled',revision:session.revision+1}; result={editor:session,outcome:{post:{id:'saved'}}}; }
   else if(name==='validate_post_editor_session') result={summary:{isValid:true,errors:[],warnings:[]},accounts:[]};
   else throw Error('Unexpected tool '+name);
   send({content:[],structuredContent:result});
 } else if(req.method==='ui/update-model-context'){ window.contexts.push(req.params); send({}); }
 else if(req.method==='ui/message'){window.messages.push(req.params);send({});}
 else if(req.method==='ui/open-link'){window.links.push(req.params);send({});}
 else if(req.id!==undefined) send({});
});
`;
const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/mcp-widgets/")) {
      const filename = path.basename(req.url.split("?")[0]);
      res.setHeader("content-type", filename.endsWith(".css") ? "text/css" : "text/javascript");
      res.end(await readFile(path.join(root, "public/mcp-widgets", filename)));
    } else if (req.url.startsWith("/widget")) {
      const name = req.url.includes("editor") ? "post-editor" : "workspace";
      const mount = name === "workspace" ? "mountWorkspaceWidget" : "mountPostEditorWidget";
      res.setHeader("content-type", "text/html");
      res.end(
        `<link rel="stylesheet" href="/mcp-widgets/${assets[name].stylesheet}"><div id="root"></div><script type="module">import {${mount}} from '/mcp-widgets/${assets[name].script}'; ${mount}();</script>`,
      );
    } else {
      res.setHeader("content-type", "text/html");
      res.end(
        `<style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><script>${fixture}</script><iframe src="/widget${req.url.includes("editor") ? "?editor" : ""}"></iframe>`,
      );
    }
  } catch (error) {
    res.statusCode = 500;
    res.end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("Widget error:", error.message);
  });
  await page.goto(base);
  const ui = page.frameLocator("iframe");
  await expect(ui.getByRole("heading", { name: "Tuesday, 29 September" })).toBeVisible();
  assert.equal(await page.evaluate(() => window.calls.length), 0, "launch must not trigger a redundant initial read");
  await ui.getByRole("button", { name: /16:30/ }).click();
  await expect(ui.getByText("Selected slot: 16:30 · Europe/Berlin")).toBeVisible();
  await ui.getByRole("button", { name: "Ask ChatGPT", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.messages))).toMatch(/selected slot/);
  await page.evaluate(() => window.removeSelection());
  await expect(ui.getByText("Selected slot: 16:30 · Europe/Berlin")).toHaveCount(0);
  await ui.getByRole("button", { name: /16:30/ }).click();
  await ui.getByRole("button", { name: "Draft for this slot" }).click();
  await expect(ui.getByLabel("Publishing time · Europe/Berlin")).toHaveValue("2026-09-29T16:30");
  await ui.getByLabel("Post text", { exact: true }).fill("Launch day. Working on the details.");
  await expect(ui.locator("simple-post-preview")).toHaveCount(2);
  await expect
    .poll(() => page.evaluate(() => window.calls.filter((c) => c.name === "update_post_editor_session").length))
    .toBeGreaterThan(0);
  // Preview component renders in Shadow DOM, so Playwright sees live text.
  await expect(ui.locator("simple-post-preview").first()).toContainText("Launch day. Working on the details.");
  await ui.getByRole("button", { name: "linkedin · Test linkedin", exact: true }).first().click();
  await ui.getByLabel("Post text", { exact: true }).fill("LinkedIn version");
  await expect(ui.locator("simple-post-preview").nth(1)).toContainText("LinkedIn version");
  await expect(ui.locator("simple-post-preview").first()).toContainText("Launch day. Working on the details.");
  await mkdir(path.resolve(root, "../e2e/test-results/extensions-smoke"), { recursive: true });
  await ui.locator("body").evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.resolve(root, "../e2e/test-results/extensions-smoke/editor-two-platforms.png"),
    fullPage: true,
  });
  for (const platform of [
    "bluesky",
    "instagram",
    "facebook",
    "threads",
    "youtube",
    "tiktok",
    "pinterest",
    "telegram",
    "forem",
  ])
    await ui.getByLabel(`Test ${platform}`, { exact: true }).check();
  await expect(ui.locator("simple-post-preview")).toHaveCount(11);
  await expect(ui.getByText("Working copy saved · draft not saved yet", { exact: true })).toBeVisible();
  await page.evaluate(() => window.propose({ message: "Suggested shared text" }));
  await expect(ui.getByRole("heading", { name: "Proposed writing changes" })).toBeVisible();
  await expect(ui.locator("simple-post-preview").first()).toContainText("Launch day. Working on the details.");
  await ui.getByRole("button", { name: "Apply to working copy" }).click();
  await expect(ui.locator("simple-post-preview").first()).toContainText("Suggested shared text");
  await expect(ui.locator("simple-post-preview").nth(1)).toContainText("LinkedIn version");
  await ui.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(ui.getByText("Draft saved. Nothing will be published.")).toBeVisible();
  await ui.getByRole("button", { name: "Review schedule", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.name === "commit_post_editor_session").length),
    1,
    "review must not schedule",
  );
  await expect(ui.getByRole("button", { name: "Confirm schedule" })).toBeVisible();
  await mkdir(path.resolve(root, "../e2e/test-results/extensions-smoke"), { recursive: true });
  await page.screenshot({
    path: path.resolve(root, "../e2e/test-results/extensions-smoke/editor.png"),
    fullPage: true,
  });
  await ui.getByRole("button", { name: "Keep editing" }).click();
  await page.setViewportSize({ width: 480, height: 900 });
  await expect(ui.getByLabel("Post text", { exact: true })).toBeVisible();
  assert.equal(
    await ui.locator("body").evaluate((el) => el.scrollWidth > window.innerWidth + 1),
    false,
    "narrow editor must not overflow",
  );
  await ui.getByRole("button", { name: "Back to workspace" }).click();
  await ui.getByText("Recover a working copy", { exact: true }).click();
  await ui.getByRole("button", { name: /Suggested shared text ·/ }).click();
  await expect(ui.getByLabel("Post text", { exact: true })).toHaveValue("Suggested shared text");
  await expect(ui.getByLabel("Publishing time · Europe/Berlin")).toHaveValue("2026-09-29T16:30");
  await expect(ui.locator("simple-post-preview").nth(1)).toContainText("LinkedIn version");
  await page.goto(`${base}/?readonly`);
  await expect(ui.getByRole("button", { name: "New draft", exact: true })).toBeDisabled();
  await page.goto(`${base}/?onboarding`);
  await expect(ui.getByRole("heading", { name: "Connect your first destination" })).toBeVisible();
  await expect(ui.getByRole("button", { name: "New draft", exact: true })).toBeDisabled();
  await ui.getByRole("button", { name: "Connect a platform", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.links))).toMatch(/accounts\?onboarding=connect/);
  await page.goto(`${base}/?editor`);
  await expect(ui.getByRole("heading", { name: "Choose a draft to edit" })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    "PASS extensions browser smoke: calendar, selection chat, slot time, autosave, 11 live previews, variant isolation, AI proposals, recovery, context removal, explicit review, narrow layout, onboarding, editor entrypoint.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
