import type { PostingResult } from "@/lib/posting";
import { getSucceededAccountIds, mergeAccountResults, toAccountResultsMap } from "@/lib/posting/account-results";

function result(overrides: Partial<PostingResult> & Pick<PostingResult, "accountId" | "success">): PostingResult {
  return {
    platform: "x",
    ...overrides,
  };
}

describe("account-results", () => {
  it("maps posting results to a per-account map", () => {
    const map = toAccountResultsMap([
      result({ accountId: "a", success: true, postId: "1", postUrl: "https://x.com/u/status/1" }),
      result({ accountId: "b", success: false, error: "API_ERROR", message: "boom" }),
    ]);

    expect(map.a).toMatchObject({ accountId: "a", success: true, postId: "1" });
    expect(map.b).toMatchObject({ accountId: "b", success: false, error: "API_ERROR", message: "boom" });
    expect(map.a.completedAt).toEqual(expect.any(String));
  });

  it("never downgrades a recorded success", () => {
    const previous = toAccountResultsMap([result({ accountId: "a", success: true, postId: "1" })]);

    const merged = mergeAccountResults(previous, [result({ accountId: "a", success: false, error: "API_ERROR" })]);

    expect(merged.a.success).toBe(true);
    expect(merged.a.postId).toBe("1");
  });

  it("replaces failed entries with the latest attempt", () => {
    const previous = toAccountResultsMap([result({ accountId: "a", success: false, error: "API_ERROR" })]);

    const merged = mergeAccountResults(previous, [result({ accountId: "a", success: true, postId: "2" })]);

    expect(merged.a.success).toBe(true);
    expect(merged.a.postId).toBe("2");
  });

  it("keeps results for accounts not in the new attempt", () => {
    const previous = toAccountResultsMap([result({ accountId: "a", success: true, postId: "1" })]);

    const merged = mergeAccountResults(previous, [result({ accountId: "b", success: true, postId: "2" })]);

    expect(Object.keys(merged).sort()).toEqual(["a", "b"]);
  });

  it("collects succeeded account ids", () => {
    const map = toAccountResultsMap([
      result({ accountId: "a", success: true }),
      result({ accountId: "b", success: false }),
    ]);

    expect([...getSucceededAccountIds(map)]).toEqual(["a"]);
    expect(getSucceededAccountIds(undefined).size).toBe(0);
    expect(getSucceededAccountIds(null).size).toBe(0);
  });
});
