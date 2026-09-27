import { landingCategory, seoRoute } from "@/lib/analytics/landing-category";

describe("landing categories", () => {
  it.each([
    ["/platforms/linkedin", "platform"],
    ["/ai/", "ai_client"],
    ["/guides/post-to-x-from-chatgpt/", "guide"],
    ["/social-media-scheduling-with-claude", "guide"],
    ["/tools/social-media-post-checker", "tool"],
    ["/compare/example", "comparison"],
    ["/social-media-scheduler-for-ai-agents/", "mcp"],
    ["/", null],
    ["/app/schedule", null],
  ])("%s → %s", (path, category) => expect(landingCategory(path)).toBe(category));

  it("rejects nested, uppercase and overlong slugs", () => {
    expect(seoRoute("/platforms/x/y")).toBeNull();
    expect(seoRoute("/ai/Claude")).toBeNull();
    expect(seoRoute(`/guides/${"ab-".repeat(40)}c`)).toBeNull();
  });
});
