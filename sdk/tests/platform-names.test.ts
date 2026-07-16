import { generatePostUrl } from "../src/platform-names";

describe("generatePostUrl", () => {
  it("uses the current public Threads domain for fallback post URLs", () => {
    expect(generatePostUrl("threads", "Da2c5fQDH3z", { username: "edmundclompton" })).toBe(
      "https://www.threads.com/@edmundclompton/post/Da2c5fQDH3z",
    );
  });
});
