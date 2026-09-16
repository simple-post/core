import { getOwnedStorageKeyFromUrl } from "@simple-post/sdk";

import { McpToolError } from "@/lib/mcp/tool-errors";
import { uploadMedia } from "@/lib/mcp/tools/media";
import { ingestPostMedia } from "@/lib/media-ingestion";

jest.mock("@simple-post/sdk", () => ({ getOwnedStorageKeyFromUrl: jest.fn() }));
jest.mock("@/lib/mcp/tools/media", () => ({ uploadMedia: jest.fn() }));

const external = "https://files.example/photo.jpg";
const managed = "https://storage.example/uploads/user/photo.jpg";

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getOwnedStorageKeyFromUrl).mockReturnValue(null);
  jest.mocked(uploadMedia).mockImplementation(async (_userId, input) => ({
    kind: "media_upload",
    type: "image",
    url: input.url === external ? managed : `https://storage.example/imported/${encodeURIComponent(input.url!)}`,
    filename: input.filename ?? "media.jpg",
    size: 123,
    mimeType: "image/jpeg",
  }));
});

it("imports shared, override, thread and thumbnail URLs once before persistence", async () => {
  const media = { id: "m1", type: "image" as const, url: external, filename: "photo.jpg", size: 0 };
  const result = await ingestPostMedia("user", {
    media: [media],
    thread: [{ message: "reply", media: [{ ...media, id: "m2" }] }],
    accountOverrides: { account: { media: [{ ...media, id: "m3" }] } },
    accountOptions: { account: { thumbnailUrl: "https://files.example/thumb.jpg" } },
  });

  expect(result.media?.[0]).toMatchObject({ url: managed, size: 123, contentType: "image/jpeg" });
  expect(result.thread?.[0].media?.[0].url).toBe(managed);
  expect(result.accountOverrides?.account.media?.[0].url).toBe(managed);
  expect(result.accountOptions?.account?.thumbnailUrl).toContain("storage.example/imported/");
  expect(uploadMedia).toHaveBeenCalledTimes(2);
});

it("keeps media that already belongs to the user without downloading it", async () => {
  jest.mocked(getOwnedStorageKeyFromUrl).mockReturnValue("uploads/user/photo.jpg");
  const media = { id: "m1", type: "image" as const, url: managed, filename: "photo.jpg", size: 123 };

  await expect(ingestPostMedia("user", { media: [media] })).resolves.toMatchObject({ media: [media] });
  expect(uploadMedia).not.toHaveBeenCalled();
});

it("returns structured recovery details when declared and detected media types differ", async () => {
  jest.mocked(uploadMedia).mockResolvedValueOnce({
    kind: "media_upload",
    type: "video",
    url: managed,
    filename: "clip.mp4",
    size: 123,
    mimeType: "video/mp4",
  });

  const error = await ingestPostMedia("user", {
    media: [{ id: "m1", type: "image", url: external, filename: "clip.mp4", size: 123 }],
  }).catch((error_) => error_);

  expect(error).toBeInstanceOf(McpToolError);
  expect(error).toMatchObject({
    code: "MEDIA_TYPE_MISMATCH",
    stage: "media_validation",
    recovery: "replace_media",
    maxAutomaticRetries: 0,
  });
});

it("registers each imported object once, even when a URL is reused", async () => {
  const onUploaded = jest.fn().mockResolvedValue(undefined);
  const media = { id: "m1", type: "image" as const, url: external, filename: "photo.jpg", size: 0 };

  await ingestPostMedia(
    "user",
    {
      media: [media],
      thread: [{ message: "reply", media: [{ ...media, id: "m2" }] }],
      accountOverrides: { account: { media: [{ ...media, id: "m3" }] } },
      accountOptions: { account: { thumbnailUrl: "https://files.example/thumb.jpg" } },
    },
    { onUploaded },
  );

  // Two distinct sources, each imported and registered exactly once.
  expect(uploadMedia).toHaveBeenCalledTimes(2);
  expect(onUploaded).toHaveBeenCalledTimes(2);
  expect(onUploaded).toHaveBeenCalledWith(managed);
});

it("does not register media the user already owns", async () => {
  jest.mocked(getOwnedStorageKeyFromUrl).mockReturnValue("uploads/user/photo.jpg");
  const onUploaded = jest.fn().mockResolvedValue(undefined);

  await ingestPostMedia(
    "user",
    { media: [{ id: "m1", type: "image" as const, url: managed, filename: "photo.jpg", size: 123 }] },
    { onUploaded },
  );

  expect(onUploaded).not.toHaveBeenCalled();
});
