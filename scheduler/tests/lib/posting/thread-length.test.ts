import { longestThreadLength } from "@/lib/posting/thread-length";

const segment = (message: string) => ({ message });

it("counts the shared thread when no account overrides it", () => {
  expect(longestThreadLength(["x-1", "bluesky-1"], [segment("a"), segment("b")], undefined)).toBe(3);
});

it("counts the longest per-account thread", () => {
  expect(
    longestThreadLength(["x-1", "bluesky-1"], [], {
      "bluesky-1": { thread: [segment("a"), segment("b"), segment("c")] },
    }),
  ).toBe(4);
});

it("ignores a shared thread every account replaces", () => {
  expect(
    longestThreadLength(["x-1"], [segment("a"), segment("b")], {
      "x-1": { thread: [] },
    }),
  ).toBe(1);
});

it("falls back to the shared thread for an override without one", () => {
  expect(longestThreadLength(["x-1"], [segment("a")], { "x-1": { message: "custom" } })).toBe(2);
});
