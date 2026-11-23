import axios from "axios";

import { blueskyFacets, firstBlueskyLink } from "../src/publishers/bluesky/richtext";

jest.mock("axios");
const get = axios.get as jest.Mock;

test("facets use UTF-8 offsets after emoji and non-Latin text without changing punctuation", async () => {
  const text = "✨ 日本語 https://example.com/path. #发布";
  const facets = await blueskyFacets(text);
  const slices = facets.map((facet) =>
    Buffer.from(text).subarray(facet.index.byteStart, facet.index.byteEnd).toString(),
  );
  expect(slices).toEqual(["https://example.com/path", "#发布"]);
  expect(firstBlueskyLink(facets)).toBe("https://example.com/path");
  expect(get).not.toHaveBeenCalled();
});

test("repeated mentions resolve once, cache successes, and failed mentions stay plain text", async () => {
  get
    .mockResolvedValueOnce({ data: { did: "did:plc:abcdefghijklmnopqrstuvwx" } })
    .mockRejectedValueOnce(new Error("unavailable"));
  const facets = await blueskyFacets(
    "@richtext-success.bsky.social @richtext-success.bsky.social @richtext-failed.bsky.social",
  );
  expect(facets).toHaveLength(2);
  expect(facets[0].features[0]).toMatchObject({ did: "did:plc:abcdefghijklmnopqrstuvwx" });
  await blueskyFacets("@richtext-success.bsky.social");
  expect(get).toHaveBeenCalledTimes(2);
});

test("plain text produces no facets or network calls", async () => {
  get.mockClear();
  expect(await blueskyFacets("A plain post with emoji ✨")).toEqual([]);
  expect(get).not.toHaveBeenCalled();
});
