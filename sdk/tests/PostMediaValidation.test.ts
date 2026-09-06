import { post, quote } from "../src";
import { getPublisher } from "../src/publishers";
import { PostErrorType } from "../src/types";
import { inspectLocalMedia, inspectRemoteMedia } from "../src/utils/media-inspection";
import { validatePostMedia } from "../src/utils/post-media-validation";

jest.mock("../src/publishers", () => ({ getPublisher: jest.fn() }));
jest.mock("../src/utils/media-inspection", () => ({
  ...jest.requireActual("../src/utils/media-inspection"),
  inspectLocalMedia: jest.fn(),
  inspectRemoteMedia: jest.fn(),
}));
const publisher = { post: jest.fn(), quote: jest.fn() };
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getPublisher).mockReturnValue(publisher as unknown as ReturnType<typeof getPublisher>);
  publisher.post.mockResolvedValue({ id: "posted", error: PostErrorType.NO_ERROR });
  publisher.quote.mockResolvedValue({ id: "quoted", error: PostErrorType.NO_ERROR });
});
it.each(["post", "quote"])("rejects inaccessible media before %s calls a platform", async (operation) => {
  jest.mocked(inspectRemoteMedia).mockRejectedValue(new Error("private URL"));
  const input = {
    platforms: ["x" as const, "instagram" as const],
    content: { text: "hi", media: [{ type: "image" as const, url: "https://drive.google.com/private" }] },
  };
  const results = operation === "post" ? await post(input) : await quote(input);
  expect([...results.values()].every((result) => result.error === PostErrorType.INVALID_CONTENT)).toBe(true);
  expect(getPublisher).not.toHaveBeenCalled();
  expect(inspectRemoteMedia).toHaveBeenCalledTimes(1);
});
it("rejects a local PNG for Instagram but allows the same file on X", async () => {
  jest.mocked(inspectLocalMedia).mockResolvedValue({ size: 1024, contentType: "image/png" });
  const results = await post({
    platforms: ["instagram", "x"],
    content: { text: "hi", media: [{ type: "image", path: "/tmp/renamed.jpg" }] },
  });
  expect(results.get("instagram")).toMatchObject({
    error: PostErrorType.INVALID_CONTENT,
    message: expect.stringContaining("PNG"),
  });
  expect(results.get("x")).toMatchObject({ error: PostErrorType.NO_ERROR });
  expect(getPublisher).toHaveBeenCalledTimes(1);
  expect(inspectLocalMedia).toHaveBeenCalledTimes(1);
});
it("rejects a video mislabeled as an image", async () => {
  jest.mocked(inspectRemoteMedia).mockResolvedValue({ size: 1024, contentType: "video/mp4" });
  const failures = await validatePostMedia({
    platforms: ["x"],
    content: { media: [{ type: "image", url: "https://example.com/image.jpg" }] },
  });
  expect(failures).toContainEqual(expect.objectContaining({ code: "media_type_mismatch" }));
});
it("checks option thumbnails before uploading the YouTube video", async () => {
  jest.mocked(inspectRemoteMedia).mockImplementation(async (url) => {
    if (url.includes("thumbnail")) throw new Error("private image");
    return { size: 1024, contentType: "video/mp4" };
  });
  const results = await post({
    platforms: ["youtube"],
    content: { media: [{ type: "video", url: "https://example.com/video.mp4" }] },
    options: { youtube: { thumbnailUrl: "https://example.com/thumbnail" } },
  });
  expect(results.get("youtube")).toMatchObject({ error: PostErrorType.INVALID_CONTENT });
  expect(getPublisher).not.toHaveBeenCalled();
});
