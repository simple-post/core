import { createFirstTouch, readFirstTouch, FIRST_TOUCH_COOKIE } from "@/lib/analytics/first-touch";
const now = new Date("2026-09-22T00:00:00Z");
const cookie = (value: unknown) => `${FIRST_TOUCH_COOKIE}=${encodeURIComponent(JSON.stringify(value))}`;
describe("first-touch attribution", () => {
  it("round-trips campaign fields while stripping private URL data", () => {
    const touch = createFirstTouch(
      "https://simplepost.social/?utm_source=ChatGPT&utm_campaign=launch&token=secret#private",
      "https://www.google.com/search?q=private",
      now,
    );
    expect(touch).toMatchObject({ source: "chatgpt", campaign: "launch", landingPage: "/" });
    expect(readFirstTouch(cookie(touch), now)).toEqual(touch);
    expect(JSON.stringify(touch)).not.toContain("secret");
  });
  it("distinguishes external, internal and absent referrers", () => {
    expect(createFirstTouch("https://simplepost.social", "https://www.google.com/search", now).source).toBe(
      "google.com",
    );
    expect(createFirstTouch("https://app.simplepost.social", "https://simplepost.social", now).source).toBe("direct");
    expect(readFirstTouch("", now)).toBeNull();
  });
  it("does not retain private app paths or email campaign tags", () => {
    expect(
      createFirstTouch("https://app.simplepost.social/posts/private?utm_source=user@example.com", "", now),
    ).toMatchObject({ source: "direct", landingPage: "/app" });
  });
  it("survives a seven-day trial but expires after 90 days", () => {
    const value = cookie(createFirstTouch("https://simplepost.social", "", now));
    expect(readFirstTouch(value, new Date("2026-09-30"))).not.toBeNull();
    expect(readFirstTouch(value, new Date("2027-01-01"))).toBeNull();
  });
  it.each([null, [], { version: 2 }, "x".repeat(3501)])("rejects malformed data %p", (value) =>
    expect(readFirstTouch(cookie(value), now)).toBeNull(),
  );
  it("rejects future timestamps and arbitrary paths", () => {
    const touch = createFirstTouch("https://simplepost.social", "", now);
    expect(readFirstTouch(cookie({ ...touch, firstSeenAt: "2027-01-01" }), now)).toBeNull();
    expect(readFirstTouch(cookie({ ...touch, landingPage: "/private/person" }), now)).toBeNull();
  });
});
