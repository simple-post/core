import { test, expect } from "@playwright/test";
import { assertPublishingProgress, verifyPublishingProgress } from "../src/verification/publishing.js";
import { SchedulerApi } from "../src/http.js";
import { config, serve, json } from "./helpers.js";
const receipt = {
  simplePostId: "saved-post",
  results: [
    {
      accountId: "account-1",
      success: true,
      postId: "root",
      threadResults: [
        { success: true, postId: "root" },
        { success: true, postId: "reply" },
      ],
    },
  ],
};
function progress() {
  return {
    checkpoints: ["root", "reply"].map((postId, segment) => ({
      accountId: "account-1",
      operation: "post",
      segment,
      state: "succeeded",
      updatedAt: "2026-09-05T12:00:00.000Z",
      result: { accountId: "account-1", success: true, postId },
    })),
  };
}
test("checks each persisted thread segment against its actual receipt", () => {
  expect(assertPublishingProgress(progress(), receipt, "account-1", 2).map((c) => c.postId)).toEqual(["root", "reply"]);
  expect(assertPublishingProgress({ checkpoints: [] }, { results: [] }, "account-1", 0)).toEqual([]);
});
for (const fault of [
  "missing",
  "duplicate",
  "unknown",
  "wrong-account",
  "wrong-id",
  "wrong-operation",
  "failed-result",
])
  test(`durability verification rejects ${fault} progress`, () => {
    const data = progress();
    if (fault === "missing") data.checkpoints.pop();
    if (fault === "duplicate") data.checkpoints[1].segment = 0;
    if (fault === "unknown") data.checkpoints[1].state = "unknown";
    if (fault === "wrong-account") data.checkpoints[1].accountId = "other";
    if (fault === "wrong-id") data.checkpoints[1].result.postId = "different-reply";
    if (fault === "wrong-operation") data.checkpoints[1].operation = "repost";
    if (fault === "failed-result") data.checkpoints[1].result.success = false;
    expect(() => assertPublishingProgress(data, receipt, "account-1", 2)).toThrow();
  });
test("verification only reads the public reconciliation endpoint and detects changing records", async () => {
  const calls: string[] = [];
  const server = await serve((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    const data = progress();
    if (calls.length === 2) data.checkpoints[1].updatedAt = "2026-09-05T12:00:01.000Z";
    json(res, data);
  });
  process.env.E2E_API_TOKEN = "fake-token";
  try {
    await expect(
      verifyPublishingProgress(new SchedulerApi(config({ baseUrl: server.url })), receipt, "account-1", 2),
    ).rejects.toThrow("preserve saved results");
    expect(calls).toEqual(Array(2).fill("GET /api/v1/posts/saved-post/reconcile"));
  } finally {
    delete process.env.E2E_API_TOKEN;
    await server.close();
  }
});
