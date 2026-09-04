import { generatePostUrl } from "../src/platform-names";

describe("generatePostUrl", () => {
  it("uses the current public Threads domain for fallback post URLs", () => {
    expect(generatePostUrl("threads", "Da2c5fQDH3z", { username: "edmundclompton" })).toBe(
      "https://www.threads.com/@edmundclompton/post/Da2c5fQDH3z",
    );
  });
});

it("builds photo permalinks and never invents a published link for inbox uploads", () => {
  expect(generatePostUrl("tiktok", "123", { username: "creator", mediaType: "image" })).toBe(
    "https://www.tiktok.com/@creator/photo/123",
  );
  expect(generatePostUrl("tiktok", "123", { username: "creator", publishMode: "draft" })).toBeUndefined();
});
