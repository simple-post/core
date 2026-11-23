import sharp from "sharp";

import { fetchCardResource } from "../src/publishers/bluesky/card-fetch";
import { parseCardMetadata, prepareBlueskyCard } from "../src/publishers/bluesky/link-card";

jest.mock("../src/publishers/bluesky/card-fetch", () => ({
  ...jest.requireActual("../src/publishers/bluesky/card-fetch"),
  fetchCardResource: jest.fn(),
}));
const fetchResource = fetchCardResource as jest.Mock;
beforeEach(() => jest.resetAllMocks());
const html = (body: string) => ({
  body: Buffer.from(body),
  url: new URL("https://example.com/page"),
  contentType: "text/html; charset=utf-8",
});

test("reads decoded Open Graph metadata and resolves relative thumbnails", () => {
  expect(
    parseCardMetadata(
      '<meta property="og:title" content="A &amp; B"><meta property="og:description" content="Description"><meta property="og:image" content="/card.png">',
      new URL("https://example.com/page"),
    ),
  ).toEqual({ title: "A & B", description: "Description", image: "https://example.com/card.png" });
});

test("validates image bytes and uploads a bounded JPEG thumbnail", async () => {
  fetchResource
    .mockResolvedValueOnce(html('<title>Title</title><meta property="og:image" content="/card.png">'))
    .mockResolvedValueOnce({
      body: await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } })
        .png()
        .toBuffer(),
    });
  const card = await prepareBlueskyCard("https://example.com/page");
  expect(card?.title).toBe("Title");
  const metadata = await sharp(card?.thumbnail).metadata();
  expect(metadata.format).toBe("jpeg");
});

test("thumbnail failure keeps a text-only card", async () => {
  fetchResource
    .mockResolvedValueOnce(html('<title>Title</title><meta property="og:image" content="/card.png">'))
    .mockRejectedValueOnce(new Error("bad image"));
  expect(await prepareBlueskyCard("https://example.com/page")).toEqual({
    uri: "https://example.com/page",
    title: "Title",
    description: "",
    thumbnail: undefined,
  });
});

test("failed or missing metadata falls back without throwing", async () => {
  fetchResource.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(html("<p>No title</p>"));
  expect(await prepareBlueskyCard("https://example.com")).toBeUndefined();
  expect(await prepareBlueskyCard("https://example.com")).toBeUndefined();
});
