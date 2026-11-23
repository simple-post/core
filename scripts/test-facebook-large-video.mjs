// Live regression: build the SDK first. Uses only unpublished videos and removes
// the IDs created by this run. Never point this at a customer's Page.
// node --env-file=/path/to/test.env scripts/test-facebook-large-video.mjs \
//   --live --page-id=TEST_PAGE_ID --video=/path/to/large.mp4 --receipt=/tmp/fb-test.json
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { FacebookPublisher, MediaResolver, S3MediaUploader } from "../sdk/dist/index.js";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const split = arg.indexOf("=");
    return split < 0 ? [arg, true] : [arg.slice(0, split), arg.slice(split + 1)];
  }),
);
assert.equal(args.get("--live"), true, "Explicit --live is required");
const pageId = process.env.FACEBOOK_PAGE_ID;
const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
assert.ok(pageId && token, "Test Page credentials are required");
assert.equal(args.get("--page-id"), pageId, "Explicit test Page ID must match credentials");
const filePath = args.get("--video");
const receiptPath = args.get("--receipt");
const modes = args.has("--mode") ? [args.get("--mode")] : ["chunks", "managed-url"];
assert.ok(
  modes.every((mode) => ["chunks", "managed-url"].includes(mode)),
  "Invalid --mode",
);
assert.equal(typeof filePath, "string");
assert.equal(typeof receiptPath, "string");
const bytes = fs.statSync(filePath).size;
assert.ok(bytes > 125_000_000, "Use a real video larger than the failed production upload");
const hash = createHash("sha256");
for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
const receipt = { startedAt: new Date().toISOString(), bytes, sha256: hash.digest("hex"), pageId, runs: [] };
const save = () => fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
save();
const api = async (id, fields, method = "GET") => {
  const response = await fetch(`https://graph.facebook.com/v25.0/${id}${fields ? `?fields=${fields}` : ""}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Graph verification failed: HTTP ${response.status}, code ${data.error?.code}`);
  return data;
};
receipt.page = await api(pageId, "id,name");
save();
let storage;
const key = `uploads/facebook-large-video-test/${randomUUID()}.mp4`;
let storageUploaded = false;
let safeToRemoveSource = true;
try {
  for (const mode of modes) {
    const run = { mode, startedAt: new Date().toISOString(), requests: [], ids: [], verified: [], deleted: [] };
    receipt.runs.push(run);
    save();
    const options = { facebook: { credentials: { pageId, pageAccessToken: token } } };
    const publisher = new FacebookPublisher(options);
    // Exercise the real publisher, changing only visibility for this test.
    publisher.client.interceptors.request.use((config) => {
      if (config.method === "post") {
        assert.equal(config.url, `/${pageId}/videos`, "Unexpected publishing endpoint");
        if (config.data instanceof URLSearchParams) {
          const phase = config.data.get("upload_phase") ?? "url";
          if (phase === "url" || phase === "finish") config.data.set("published", "false");
          assert.ok(phase === "start" || config.data.get("published") === "false");
          run.requests.push({
            phase,
            bodyBytes: Buffer.byteLength(config.data.toString()),
            unpublished: phase !== "start",
          });
        } else {
          assert.equal(mode, "chunks");
          run.requests.push({ phase: "transfer" });
        }
        save();
      }
      return config;
    });
    publisher.client.interceptors.response.use((response) => {
      const id = response.data.id ?? response.data.video_id;
      if (id && response.config.method === "post" && !run.ids.includes(id)) {
        run.ids.push(id);
        save();
      }
      return response;
    });
    const resolver = new MediaResolver();
    try {
      let media = [{ type: "video", path: filePath, title: "Simple Post large-video regression test" }];
      if (mode === "managed-url") {
        storage ??= new S3MediaUploader();
        const url = await storage.uploadFile(filePath, key);
        storageUploaded = true;
        receipt.storageKey = key;
        save();
        media = await resolver.resolve([{ type: "video", url, title: media[0].title }], ["facebook"]);
        safeToRemoveSource = false;
      }
      const result = await publisher.post(
        { text: "Synthetic test pattern. Unpublished regression test.", media },
        options,
      );
      run.result = result;
      save();
      assert.equal(result.error, "NO_ERROR", `Upload failed: ${result.message}`);
      assert.equal(run.requests.filter((request) => request.phase === "url").length, mode === "managed-url" ? 1 : 0);
      for (const id of run.ids) {
        const video = await api(id, "id,status,published,length");
        run.verified.push(video);
        save();
        assert.equal(video.published, false, "Test video must remain unpublished");
        assert.equal(video.status.video_status, "ready");
        assert.ok(Math.abs(video.length - 24) < 1, "Full 24-second fixture must be present");
      }
      safeToRemoveSource = true;
      run.passed = true;
      console.log(JSON.stringify({ mode, bytes, result: "passed", videos: run.verified }));
    } finally {
      await resolver.cleanup();
      for (const id of run.ids) {
        const deletion = await api(id, "", "DELETE");
        assert.equal(deletion.success, true);
        run.deleted.push(id);
        save();
      }
      if (run.deleted.length > 0 && run.deleted.length === run.ids.length) safeToRemoveSource = true;
    }
  }
  receipt.passed = true;
} catch (error) {
  // Do not log Axios errors or request configs containing access tokens.
  receipt.failure = error instanceof Error ? error.message.replaceAll(token, "[redacted]") : "Test failed";
  console.error(receipt.failure);
  process.exitCode = 1;
} finally {
  if (storageUploaded && safeToRemoveSource) {
    await storage.deleteFile(key);
    receipt.storageDeleted = true;
  }
  receipt.finishedAt = new Date().toISOString();
  save();
}
