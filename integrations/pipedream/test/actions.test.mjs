import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import createPost from "../components/simplepost/actions/create-post/create-post.mjs";
import getPost from "../components/simplepost/actions/get-post/get-post.mjs";
import listAccounts from "../components/simplepost/actions/list-accounts/list-accounts.mjs";
import uploadMedia from "../components/simplepost/actions/upload-media/upload-media.mjs";
import validatePost from "../components/simplepost/actions/validate-post/validate-post.mjs";
import { API_KEY, createApp, runAction, startScheduler } from "./helpers.mjs";

// Request fields accepted by the Scheduler's createPostSchema and
// validationRequestSchema (scheduler/lib/validations/posts.ts).
const CREATE_POST_FIELDS = new Set([
  "imageFit",
  "message",
  "accountIds",
  "postingMode",
  "scheduledFor",
  "accountOptions",
  "accountOverrides",
  "repost",
  "media",
  "thread",
  "idempotencyKey",
  "quotePostId",
]);
const VALIDATION_FIELDS = new Set([
  "imageFit",
  "message",
  "media",
  "accountIds",
  "accountOptions",
  "accountOverrides",
  "thread",
]);
const MEDIA_FIELDS = new Set(["id", "url", "thumbnailUrl", "type", "contentType", "filename", "size", "durationSec"]);

const ACCOUNTS = [
  { id: "acc_bsky", platform: "bluesky", username: "jane.bsky.social", displayName: "Jane", previewOnly: false },
  {
    id: "acc_x",
    platform: "x",
    username: "jane",
    displayName: "Jane",
    previewOnly: false,
    credentialStatus: { state: "reauth_required" },
  },
  { id: "acc_preview", platform: "instagram", username: "preview", previewOnly: true },
];

function postResponse(request, overrides = {}) {
  const status = { now: "published", schedule: "scheduled", draft: "draft" }[request.body.postingMode];
  return {
    status: 201,
    body: {
      post: {
        id: "post_1",
        status,
        scheduledFor: request.body.scheduledFor ?? null,
        ...overrides,
      },
    },
  };
}

async function withScheduler(routes, fn) {
  const scheduler = await startScheduler(routes);
  try {
    await fn(scheduler, createApp(scheduler.baseUrl));
  } finally {
    await scheduler.close();
  }
}

test("requests use bearer API-key auth against the configured base URL", async () => {
  await withScheduler({ "GET /api/v1/accounts": () => ({ body: { accounts: ACCOUNTS } }) }, async (scheduler, app) => {
    await runAction(listAccounts, { simplepost: app });
    const [request] = scheduler.requests;
    assert.equal(request.path, "/api/v1/accounts");
    assert.equal(request.headers.authorization, `Bearer ${API_KEY}`);
  });
});

test("the default base URL is the hosted Scheduler", () => {
  const app = createApp("unused");
  app.$auth.base_url = undefined;
  assert.equal(app._baseUrl(), "https://app.simplepost.social");
});

test("account options hide preview-only accounts and flag reconnects", async () => {
  await withScheduler({ "GET /api/v1/accounts": () => ({ body: { accounts: ACCOUNTS } }) }, async (_scheduler, app) => {
    const options = await app.propOptions("accountIds");
    assert.deepEqual(options, [
      { label: "Jane (@jane.bsky.social, bluesky)", value: "acc_bsky" },
      { label: "Jane (@jane, x) - reconnect required", value: "acc_x" },
    ]);
  });
});

test("post options page through every post list", async () => {
  await withScheduler(
    {
      "GET /api/v1/posts": (request) => ({
        body: { posts: [{ id: `post_${request.query.type}`, status: request.query.type, message: "Hello" }] },
      }),
    },
    async (scheduler, app) => {
      const options = await app.propOptions("postId", { page: 1 });
      assert.equal(options.length, 4);
      assert.deepEqual(
        scheduler.requests.map((request) => request.query),
        ["scheduled", "drafts", "past", "failed"].map((type) => ({ type, page: "2", limit: "25" })),
      );
    },
  );
});

test("Create Post publishes now with only supported fields", async () => {
  await withScheduler({ "POST /api/v1/posts": (request) => postResponse(request) }, async (scheduler, app) => {
    const { summary } = await runAction(createPost, {
      simplepost: app,
      accountIds: ["acc_bsky"],
      postingMode: "now",
      message: "Hello",
    });
    const [request] = scheduler.requests;
    assert.deepEqual(request.body, { message: "Hello", accountIds: ["acc_bsky"], postingMode: "now" });
    assert.equal(summary, "Published post post_1");
  });
});

test("Create Post schedules in UTC and maps every optional field", async () => {
  await withScheduler({ "POST /api/v1/posts": (request) => postResponse(request) }, async (scheduler, app) => {
    const { summary } = await runAction(createPost, {
      simplepost: app,
      accountIds: ["acc_bsky", "acc_x"],
      postingMode: "schedule",
      scheduledFor: "2030-01-01T10:00:00+01:00",
      message: "Hello",
      mediaUrls: ["https://cdn.example.com/a/photo.JPG", "https://cdn.example.com/clip.mov?sig=1"],
      media: JSON.stringify({
        id: "k",
        url: "https://media.simplepost.social/u/k.png",
        type: "image",
        filename: "k.png",
        size: 10,
      }),
      imageFit: "blur",
      thread: "[{\"message\":\"Part 2\"}]",
      accountOptions: { acc_x: { replyToId: "123" } },
      accountOverrides: "{\"acc_x\":{\"message\":\"Short\"}}",
      quotePostId: "post_0",
      repost: true,
      repostDelayHours: 6,
      idempotencyKey: "evt_1",
    });
    const { body } = scheduler.requests[0];
    for (const field of Object.keys(body)) assert.ok(CREATE_POST_FIELDS.has(field), `unexpected field ${field}`);
    for (const item of body.media) {
      for (const field of Object.keys(item)) assert.ok(MEDIA_FIELDS.has(field), `unexpected media field ${field}`);
    }
    assert.equal(body.scheduledFor, "2030-01-01T09:00:00.000Z");
    assert.deepEqual(
      body.media.map(({ type, contentType, filename }) => [type, contentType, filename]),
      [
        ["image", "image/jpeg", "photo.JPG"],
        ["video", "video/quicktime", "clip.mov"],
        ["image", undefined, "k.png"],
      ],
    );
    assert.equal(body.imageFit, "blur");
    assert.deepEqual(body.thread, [{ message: "Part 2" }]);
    assert.deepEqual(body.accountOptions, { acc_x: { replyToId: "123" } });
    assert.deepEqual(body.accountOverrides, { acc_x: { message: "Short" } });
    assert.equal(body.quotePostId, "post_0");
    assert.deepEqual(body.repost, { enabled: true, delayHours: 6 });
    assert.equal(body.idempotencyKey, "evt_1");
    assert.equal(summary, "Scheduled post post_1 for 2030-01-01T09:00:00.000Z");
  });
});

test("Create Post can turn repost off explicitly and leaves the account default otherwise", async () => {
  await withScheduler({ "POST /api/v1/posts": (request) => postResponse(request) }, async (scheduler, app) => {
    const base = { simplepost: app, accountIds: ["acc_bsky"], postingMode: "draft" };
    await runAction(createPost, { ...base, repost: false });
    await runAction(createPost, base);
    assert.deepEqual(scheduler.requests[0].body.repost, { enabled: false });
    assert.equal("repost" in scheduler.requests[1].body, false);
    assert.equal(scheduler.requests[0].body.message, "");
  });
});

test("Create Post reports failed and replayed posts without throwing", async () => {
  await withScheduler(
    {
      "POST /api/v1/posts": (request) =>
        request.body.idempotencyKey
          ? { status: 200, body: { post: { id: "post_1", status: "published" }, replayed: true } }
          : postResponse(request, { status: "failed", errorMessage: "Failed on 2 platform(s)" }),
    },
    async (_scheduler, app) => {
      const base = { simplepost: app, accountIds: ["acc_bsky"], postingMode: "now", message: "Hi" };
      const failed = await runAction(createPost, base);
      assert.equal(failed.summary, "Post post_1 failed to publish: Failed on 2 platform(s)");
      const replayed = await runAction(createPost, { ...base, idempotencyKey: "evt_1" });
      assert.equal(replayed.summary, "Published post post_1 (existing post returned for this idempotency key)");
    },
  );
});

test("Create Post rejects bad configuration before calling the API", async () => {
  await withScheduler({}, async (scheduler, app) => {
    const base = { simplepost: app, accountIds: ["acc_bsky"] };
    await assert.rejects(runAction(createPost, { ...base, postingMode: "schedule" }), /Scheduled For\*\* is required/);
    await assert.rejects(
      runAction(createPost, { ...base, postingMode: "schedule", scheduledFor: "tomorrow" }),
      /valid ISO 8601/,
    );
    await assert.rejects(runAction(createPost, { ...base, postingMode: "now", thread: "[{" }), /Thread \(JSON\)\*\* must be valid JSON/);
    await assert.rejects(
      runAction(createPost, { ...base, postingMode: "now", mediaUrls: ["https://example.com/download?id=1"] }),
      /Cannot tell whether/,
    );
    assert.equal(scheduler.requests.length, 0);
  });
});

test("API errors surface the Scheduler's message", async () => {
  await withScheduler(
    { "POST /api/v1/posts": () => ({ status: 403, body: { error: "API access is not included in your Free plan" } }) },
    async (_scheduler, app) => {
      await assert.rejects(
        runAction(createPost, { simplepost: app, accountIds: ["acc_bsky"], postingMode: "now", message: "Hi" }),
        /API access is not included/,
      );
    },
  );
});

test("Validate Post sends only validation fields and summarizes errors", async () => {
  await withScheduler(
    {
      "POST /api/v1/validation": () => ({
        body: {
          summary: { isValid: false, errors: [{ code: "too_long", message: "X allows 280 characters" }], warnings: [] },
        },
      }),
    },
    async (scheduler, app) => {
      const { summary } = await runAction(validatePost, {
        simplepost: app,
        accountIds: ["acc_x"],
        message: "x".repeat(300),
        mediaUrls: ["https://example.com/a.webp"],
      });
      const { body } = scheduler.requests[0];
      for (const field of Object.keys(body)) assert.ok(VALIDATION_FIELDS.has(field), `unexpected field ${field}`);
      assert.equal(body.media[0].type, "image");
      assert.equal(summary, "Post has 1 validation error(s): X allows 280 characters");
    },
  );
});

test("List Accounts filters by platform", async () => {
  await withScheduler({ "GET /api/v1/accounts": () => ({ body: { accounts: ACCOUNTS } }) }, async (_scheduler, app) => {
    const { result, summary } = await runAction(listAccounts, { simplepost: app, platform: "Bluesky" });
    assert.deepEqual(result.map((account) => account.id), ["acc_bsky"]);
    assert.equal(summary, "Found 1 connected account(s)");
  });
});

test("Get Post returns the post", async () => {
  await withScheduler(
    { "GET /api/v1/posts/post%2F1": () => ({ body: { post: { id: "post/1", status: "published" } } }) },
    async (_scheduler, app) => {
      const { result, summary } = await runAction(getPost, { simplepost: app, postId: "post/1" });
      assert.equal(result.id, "post/1");
      assert.equal(summary, "Retrieved post post/1 (published)");
    },
  );
});

test("Upload Media streams a /tmp file as multipart and returns a media object", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "simplepost-")), "photo.png");
  fs.writeFileSync(file, Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"));
  await withScheduler(
    {
      "POST /api/v1/upload": (request) => {
        const raw = request.raw.toString("latin1");
        assert.match(request.headers["content-type"], /^multipart\/form-data; boundary=/);
        assert.match(raw, /name="file"; filename="photo.png"/);
        assert.match(raw, /Content-Type: image\/png/);
        return {
          body: {
            url: "https://media.simplepost.social/u/photo.png",
            key: "u/photo.png",
            filename: "photo.png",
            size: 16,
            type: "image/png",
          },
        };
      },
    },
    async (_scheduler, app) => {
      const { result, summary } = await runAction(uploadMedia, { simplepost: app, file });
      assert.deepEqual(result.media, {
        id: "u/photo.png",
        url: "https://media.simplepost.social/u/photo.png",
        type: "image",
        contentType: "image/png",
        filename: "photo.png",
        size: 16,
      });
      assert.equal(summary, "Uploaded photo.png (16 bytes)");
    },
  );
});
