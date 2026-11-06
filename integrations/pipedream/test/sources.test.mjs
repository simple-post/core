import assert from "node:assert/strict";
import test from "node:test";

import postFailed from "../components/simplepost/sources/post-failed-instant/post-failed-instant.mjs";
import postPublished from "../components/simplepost/sources/post-published-instant/post-published-instant.mjs";
import { createApp, sign, startScheduler } from "./helpers.mjs";

const SECRET = "whsec_test";
const ENDPOINT = "https://eo123.m.pipedream.net";

/** Builds a deployed source instance the way Pipedream binds `this`. */
function createSource(component, app) {
  const store = new Map();
  const instance = {
    simplepost: app,
    db: { get: (key) => store.get(key), set: (key, value) => store.set(key, value) },
    http: {
      endpoint: ENDPOINT,
      responses: [],
      respond(response) {
        this.responses.push(response);
      },
    },
    emitted: [],
    $emit(event, meta) {
      this.emitted.push({ event, meta });
    },
  };
  for (const [name, method] of Object.entries(component.methods)) {
    instance[name] = method.bind(instance);
  }
  return { instance, store };
}

function delivery(body, { secret = SECRET, timestamp = String(Date.now()) } = {}) {
  const bodyRaw = JSON.stringify(body);
  return {
    method: "POST",
    headers: {
      "x-simplepost-event": body.event,
      "x-simplepost-timestamp": timestamp,
      "x-simplepost-signature": sign(secret, timestamp, bodyRaw),
    },
    bodyRaw,
    body,
  };
}

test("activate registers a webhook for one event and deactivate removes it", async () => {
  const scheduler = await startScheduler({
    "POST /api/v1/webhooks": () => ({ status: 201, body: { webhook: { id: "wh_1", secret: SECRET } } }),
    "DELETE /api/v1/webhooks/wh_1": () => ({ body: { success: true } }),
  });
  try {
    const { instance, store } = createSource(postPublished, createApp(scheduler.baseUrl));
    await postPublished.hooks.activate.call(instance);
    assert.deepEqual(scheduler.requests[0].body, { url: ENDPOINT, events: ["post.published"] });
    assert.equal(store.get("hookId"), "wh_1");
    assert.equal(store.get("secret"), SECRET);

    await postPublished.hooks.deactivate.call(instance);
    assert.equal(scheduler.requests[1].method, "DELETE");
    assert.equal(store.get("hookId"), null);

    // A second deactivate (or one after a failed activate) is a no-op.
    await postPublished.hooks.deactivate.call(instance);
    assert.equal(scheduler.requests.length, 2);
  } finally {
    await scheduler.close();
  }
});

test("deploy emits recent posts as historical events", async () => {
  const scheduler = await startScheduler({
    "GET /api/v1/posts": () => ({
      body: {
        posts: [
          { id: "post_2", status: "failed", message: "B", errorMessage: "Boom", updatedAt: "2030-01-02T00:00:00.000Z" },
          { id: "post_1", status: "failed", message: "A", errorMessage: "Bang", updatedAt: "2030-01-01T00:00:00.000Z" },
        ],
      },
    }),
  });
  try {
    const { instance } = createSource(postFailed, createApp(scheduler.baseUrl));
    await postFailed.hooks.deploy.call(instance);
    assert.deepEqual(scheduler.requests[0].query, { type: "failed", limit: "25" });
    assert.deepEqual(
      instance.emitted.map(({ event, meta }) => [event.event, event.post.id, meta.summary]),
      [
        ["post.failed", "post_1", "Post failed: Bang"],
        ["post.failed", "post_2", "Post failed: Boom"],
      ],
    );
  } finally {
    await scheduler.close();
  }
});

test("run emits signed deliveries with a stable id under 64 characters", async () => {
  const { instance, store } = createSource(postPublished, createApp("http://unused"));
  store.set("secret", SECRET);
  const event = delivery(postPublished.sampleEmit);
  await postPublished.run.call(instance, event);

  assert.deepEqual(instance.http.responses, [{ status: 200 }]);
  assert.equal(instance.emitted.length, 1);
  const { meta } = instance.emitted[0];
  assert.equal(meta.id, `cm8x1k2ab0002-post.published-${Date.parse(postPublished.sampleEmit.createdAt)}`);
  assert.ok(meta.id.length <= 64);
  assert.equal(meta.summary, "Post published: Our spring collection is live!");
});

test("run rejects bad signatures and stale timestamps", async () => {
  const { instance, store } = createSource(postFailed, createApp("http://unused"));
  store.set("secret", SECRET);

  await postFailed.run.call(instance, delivery(postFailed.sampleEmit, { secret: "whsec_wrong" }));
  await postFailed.run.call(
    instance,
    delivery(postFailed.sampleEmit, { timestamp: String(Date.now() - 10 * 60 * 1000) }),
  );
  const tampered = delivery(postFailed.sampleEmit);
  tampered.bodyRaw = tampered.bodyRaw.replace("failed", "published");
  await postFailed.run.call(instance, tampered);

  assert.deepEqual(instance.http.responses, [{ status: 401 }, { status: 401 }, { status: 401 }]);
  assert.equal(instance.emitted.length, 0);
});

test("run ignores events for the other trigger", async () => {
  const { instance, store } = createSource(postFailed, createApp("http://unused"));
  store.set("secret", SECRET);
  await postFailed.run.call(instance, delivery(postPublished.sampleEmit));
  assert.deepEqual(instance.http.responses, [{ status: 200 }]);
  assert.equal(instance.emitted.length, 0);
});
