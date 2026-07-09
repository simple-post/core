import { createPostingProgressStream, POSTING_PROGRESS_CONTENT_TYPE } from "@/lib/posting/progress-stream";

describe("posting progress stream", () => {
  it("emits account results before the final API response", async () => {
    const response = createPostingProgressStream(async (onResult) => {
      onResult({
        accountId: "x-1",
        platform: "x",
        success: true,
        postId: "1",
        postUrl: "https://x.com/alice/status/1",
      });

      return Response.json({ post: { id: "post-1" }, postingResults: [] }, { status: 201 });
    });

    expect(response.headers.get("content-type")).toContain(POSTING_PROGRESS_CONTENT_TYPE);

    const body = await response.text();
    const events = body
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });

    expect(events.map((event) => event.type)).toEqual(["result", "complete"]);
  });

  it("turns a failed API response into a stream error event", async () => {
    const response = createPostingProgressStream(async () => Response.json({ error: "Not allowed" }, { status: 403 }));
    const body = await response.text();
    const events = body
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; error?: string });

    expect(events).toEqual([{ type: "error", error: "Not allowed" }]);
  });
});
