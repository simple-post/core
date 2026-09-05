import fs from "node:fs";

import axios from "axios";

import { TikTokPublisher } from "../src/publishers/tiktok";
import { getTikTokPostText, validateTikTokContent } from "../src/publishers/tiktok/validation";
import { PostErrorType } from "../src/types";
import { MediaResolver } from "../src/utils/media-resolver";
import { S3MediaUploader } from "../src/utils/s3";

import type { Content, TikTokOptions, PostOptionsWithCredentials } from "../src/types/post";

jest.mock("axios");
jest.mock("fs");
jest.mock("../src/utils/s3", () => ({ S3MediaUploader: jest.fn() }));
const api = { post: jest.fn() };
const uploadFile = jest.fn();
const deleteFile = jest.fn();
const credentials = { accessToken: "test-token" };
const options = (extra: TikTokOptions = {}): PostOptionsWithCredentials => ({
  tiktok: { credentials, privacyLevel: "SELF_ONLY", ...extra },
});
const photos = (count = 7): Content => ({
  text: "Our photo story",
  media: Array.from({ length: count }, (_, i) => ({
    type: "image" as const,
    url: `https://media.example.com/${i}.jpg`,
  })),
});
const publisher = () => new TikTokPublisher(options());
function mockPublish(draft = false, status = draft ? "SEND_TO_USER_INBOX" : "PUBLISH_COMPLETE") {
  if (!draft)
    api.post.mockResolvedValueOnce({
      data: { data: { creator_username: "creator", privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } },
    });
  api.post.mockResolvedValueOnce({ data: { data: { publish_id: "p_pub_url~123" }, error: { code: "ok" } } });
  api.post.mockResolvedValueOnce({
    data: {
      data: {
        status,
        publicaly_available_post_id: status === "PUBLISH_COMPLETE" ? ["123"] : undefined,
        fail_reason: "photo_pull_failed",
      },
    },
  });
}
beforeEach(() => {
  jest.resetAllMocks();
  (axios.create as jest.Mock).mockReturnValue(api);
  (axios.head as jest.Mock).mockResolvedValue({ headers: { "content-type": "image/jpeg", "content-length": "1024" } });
  (fs.statSync as jest.Mock).mockReturnValue({ size: 1024 });
  uploadFile.mockImplementation(async (_path, key) => `https://media.example.com/${key}`);
  (S3MediaUploader as jest.Mock).mockImplementation(() => ({ uploadFile, deleteFile }));
});
it("preserves Arabic text, emoji and hashtags in the photo title and description", async () => {
  mockPublish();
  const content = { ...photos(), text: "هدوء التفاصيل يصنع فخامة المكان ✨ #IBDesign" };
  await publisher().postContent(content, options({ autoAddMusic: true }));
  expect(api.post.mock.calls[1][1].post_info).toMatchObject({
    title: content.text,
    description: content.text,
    auto_add_music: true,
  });
});
it("shortens only the derived title without splitting emoji or losing the full caption", () => {
  const content = { ...photos(), text: `${"a".repeat(89)}✨😀 #tag` };
  expect(getTikTokPostText(content)).toEqual({ title: `${"a".repeat(89)}✨`, description: content.text });
  expect(getTikTokPostText({ ...content, text: `${"a".repeat(89)}😀 #tag` }).title).toBe("a".repeat(89));
  expect(getTikTokPostText(content, { title: "", description: "" })).toEqual({ title: "", description: "" });
});
it.each([1, 4, 7, 35])("publishes %i photos in order with recommended music and a cover", async (count) => {
  mockPublish();
  const content = photos(count);
  const result = await publisher().postContent(
    content,
    options({ title: "A story", autoAddMusic: true, photoCoverIndex: count - 1 }),
  );
  expect(api.post).toHaveBeenCalledWith("/v2/post/publish/content/init/", {
    media_type: "PHOTO",
    post_mode: "DIRECT_POST",
    post_info: {
      title: "A story",
      description: content.text,
      privacy_level: "SELF_ONLY",
      disable_comment: true,
      auto_add_music: true,
      brand_content_toggle: false,
      brand_organic_toggle: false,
    },
    source_info: {
      source: "PULL_FROM_URL",
      photo_cover_index: count - 1,
      photo_images: content.media!.map((item) => item.url),
    },
  });
  expect(result).toMatchObject({
    id: "123",
    error: PostErrorType.NO_ERROR,
    url: "https://www.tiktok.com/@creator/photo/123",
  });
  expect(axios.put).not.toHaveBeenCalled();
  expect(axios.head).toHaveBeenCalledWith(content.media![0].url, { timeout: 30_000, maxRedirects: 0 });
});
it.each([undefined, false])("keeps automatic music off when it is %s", async (autoAddMusic) => {
  mockPublish();
  await publisher().postContent(photos(), options({ autoAddMusic }));
  expect(api.post.mock.calls[1][1].post_info.auto_add_music).toBe(false);
});
it("uploads photos to the inbox without publishing or querying direct-post settings", async () => {
  mockPublish(true);
  const result = await publisher().postContent(photos(), {
    tiktok: { credentials, publishMode: "draft", title: "Title", description: "Description" },
  });
  expect(api.post.mock.calls[0]).toEqual([
    "/v2/post/publish/content/init/",
    {
      media_type: "PHOTO",
      post_mode: "MEDIA_UPLOAD",
      post_info: { title: "Title", description: "Description" },
      source_info: {
        source: "PULL_FROM_URL",
        photo_cover_index: 0,
        photo_images: photos().media!.map((item) => item.url),
      },
    },
  ]);
  expect(api.post).not.toHaveBeenCalledWith("/v2/post/publish/creator_info/query/");
  expect(result).toMatchObject({
    id: "p_pub_url~123",
    message: expect.stringContaining("publish manually"),
    extraData: { platformData: { status: "SEND_TO_USER_INBOX", publishMode: "draft" } },
  });
  expect(result.url).toBeUndefined();
});
it("stages local photos and removes them only after TikTok receives them", async () => {
  api.post.mockImplementation(async (endpoint) => {
    expect(deleteFile).not.toHaveBeenCalled();
    return endpoint === "/v2/post/publish/content/init/"
      ? { data: { data: { publish_id: "p_pub_url~123" } } }
      : { data: { data: { status: "SEND_TO_USER_INBOX" } } };
  });
  await publisher().postContent(
    { media: [{ type: "image", path: "/tmp/photo.jpg", url: "https://temporary.example/photo.jpg" }] },
    options({ publishMode: "draft" }),
  );
  expect(uploadFile).toHaveBeenCalledWith("/tmp/photo.jpg", expect.stringMatching(/^tiktok_.*\.jpg$/));
  expect(deleteFile).toHaveBeenCalledTimes(1);
});
it("retains staged media after an ambiguous init timeout", async () => {
  api.post.mockRejectedValue(new Error("timeout"));
  await expect(
    publisher().postContent({ media: [{ type: "image", path: "/tmp/photo.jpg" }] }, options({ publishMode: "draft" })),
  ).rejects.toThrow("timeout");
  expect(uploadFile).toHaveBeenCalledTimes(1);
  expect(deleteFile).not.toHaveBeenCalled();
});
it("reports TikTok processing failures as failures", async () => {
  mockPublish(true, "FAILED");
  const result = await publisher().post(photos(), options({ publishMode: "draft" }));
  expect(result).toMatchObject({
    error: PostErrorType.API_ERROR,
    message: expect.stringContaining("photo_pull_failed"),
  });
});
it("rejects API errors returned with HTTP 200", async () => {
  api.post.mockResolvedValue({ data: { error: { code: "url_ownership_unverified", message: "Unverified domain" } } });
  await expect(publisher().postContent(photos(), options({ publishMode: "draft" }))).rejects.toThrow(
    "url_ownership_unverified",
  );
});
it("rejects a redirected image origin before submitting", async () => {
  (axios.head as jest.Mock).mockRejectedValue(new Error("302 redirect"));
  await expect(publisher().postContent(photos(), options({ publishMode: "draft" }))).rejects.toThrow("302 redirect");
  expect(api.post).not.toHaveBeenCalled();
});
it.each([
  { "content-type": "image/png", "content-length": "1024" },
  { "content-type": "image/jpeg", "content-length": String(21 * 1024 * 1024) },
])("rejects unsupported or oversized photo origins", async (headers) => {
  (axios.head as jest.Mock).mockResolvedValue({ headers });
  await expect(publisher().postContent(photos(), options({ publishMode: "draft" }))).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("validates count, mixed media, text, cover and music options", () => {
  const valid = photos();
  expect(validateTikTokContent({ ...valid, text: "x".repeat(4000) }).isValid).toBe(true);
  for (const [content, settings] of [
    [photos(36), {}],
    [photos(0), {}],
    [{ media: [...valid.media!, { type: "video", url: "https://media.example/v.mp4" }] }, {}],
    [
      {
        media: [
          { type: "video", path: "a.mp4" },
          { type: "video", path: "b.mp4" },
        ],
      },
      {},
    ],
    [{ ...valid, text: "x".repeat(4001) }, {}],
    [valid, { title: "x".repeat(91) }],
    [valid, { description: "x".repeat(4001) }],
    [valid, { photoCoverIndex: 7 }],
    [valid, { photoCoverIndex: -1 }],
    [valid, { autoAddMusic: true, publishMode: "draft" }],
    [{ media: [{ type: "video", path: "a.mp4" }] }, { autoAddMusic: true }],
    [{ media: [{ type: "image", url: "http://example.com/a.jpg" }] }, {}],
    [{ media: [{ type: "image", path: "photo.png" }] }, {}],
    [{ media: [{ type: "image", path: "photo.jpg", size: 21 * 1024 * 1024 }] }, {}],
  ] as Array<[Content, TikTokOptions]>)
    expect(validateTikTokContent(content, settings).isValid).toBe(false);
  expect(validateTikTokContent({ ...valid, text: "x".repeat(4001) }, { description: "Override" }).isValid).toBe(true);
});

it("leaves TikTok photos intact during shared preparation so the publisher owns staging", async () => {
  const media = [...photos().media!, { type: "image" as const, path: "/tmp/photo.jpg" }];
  const resolver = new MediaResolver();
  expect(await resolver.resolve(media, ["tiktok"])).toEqual(media);
  await resolver.cleanup();
  expect(uploadFile).not.toHaveBeenCalled();
  expect(deleteFile).not.toHaveBeenCalled();
});
