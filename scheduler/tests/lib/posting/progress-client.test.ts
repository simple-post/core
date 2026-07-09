import {
  failPendingPostingResults,
  mergePostingProgressResult,
  mergePostingProgressResults,
} from "@/lib/posting/progress-client";

describe("posting progress client state", () => {
  const pending = [
    { accountId: "x-1", platform: "x", accountName: "@alice" },
    { accountId: "ig-1", platform: "instagram", accountName: "@alice" },
  ];

  it("updates one completed account and preserves its display name", () => {
    const updated = mergePostingProgressResult(pending, {
      accountId: "x-1",
      platform: "x",
      success: true,
      postUrl: "https://x.com/alice/status/1",
    });

    expect(updated[0]).toMatchObject({
      accountName: "@alice",
      success: true,
      postUrl: "https://x.com/alice/status/1",
    });
    expect(updated[1].success).toBeUndefined();
  });

  it("reconciles the final response without changing account order", () => {
    const updated = mergePostingProgressResults(pending, [
      { accountId: "ig-1", platform: "instagram", success: false, error: "Upload failed" },
      { accountId: "x-1", platform: "x", success: true },
    ]);

    expect(updated.map((result) => result.accountId)).toEqual(["x-1", "ig-1"]);
    expect(updated.map((result) => result.success)).toEqual([true, false]);
  });

  it("marks only unfinished accounts as failed after a request error", () => {
    const updated = failPendingPostingResults(
      [
        { accountId: "x-1", platform: "x", success: true },
        { accountId: "ig-1", platform: "instagram" },
      ],
      "Connection lost",
    );

    expect(updated[0]).toMatchObject({ success: true });
    expect(updated[1]).toMatchObject({ success: false, error: "Connection lost" });
  });
});
