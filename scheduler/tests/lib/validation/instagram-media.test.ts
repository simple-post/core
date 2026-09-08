import { unlink } from "node:fs/promises";

import { downloadToTempFile } from "@simple-post/sdk";
import sharp from "sharp";

import { validateInstagramPhotoDimensions } from "@/lib/validation/instagram-media";

jest.mock("node:fs/promises", () => ({ unlink: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@simple-post/sdk", () => ({ downloadToTempFile: jest.fn() }));
jest.mock("sharp", () => jest.fn());
const metadata = jest.fn();
const media = [
  { id: "photo", type: "image" as const, url: "https://example.com/photo.jpg", filename: "photo.jpg", size: 1 },
];
const accounts = [{ id: "instagram-1", platform: "instagram" }];

beforeEach(() => {
  jest.clearAllMocks();
  (downloadToTempFile as jest.Mock).mockResolvedValue("/tmp/photo.jpg");
  (sharp as unknown as jest.Mock).mockReturnValue({ metadata });
});
it.each([
  [864, 1080],
  [1910, 1000],
  [1080, 1080],
])("accepts %i×%i photos and cleans up", async (width, height) => {
  metadata.mockResolvedValue({ width, height });
  expect(await validateInstagramPhotoDimensions({ media, accounts })).toEqual([]);
  expect(unlink).toHaveBeenCalledWith("/tmp/photo.jpg");
});
it("rejects unsupported aspect ratios before Instagram submission and inspects shared URLs once", async () => {
  metadata.mockResolvedValue({ width: 540, height: 1080 });
  const failures = await validateInstagramPhotoDimensions({
    media,
    accounts: [...accounts, { id: "instagram-2", platform: "Instagram" }],
  });
  expect(failures).toHaveLength(2);
  expect(failures[0]).toMatchObject({
    code: "photo_aspect_ratio_unsupported",
    field: "text.media[0]",
    meta: { accountId: "instagram-1" },
  });
  expect(downloadToTempFile).toHaveBeenCalledTimes(1);
  expect(downloadToTempFile).toHaveBeenCalledWith(media[0].url, undefined, 8 * 1024 * 1024);
});
it("inspects account overrides and blocks uninspectable images", async () => {
  metadata.mockRejectedValue(new Error("invalid image"));
  const override = [{ ...media[0], url: "https://example.com/override.jpg" }];
  const failures = await validateInstagramPhotoDimensions({
    media,
    accounts,
    accountOverrides: { "instagram-1": { media: override } },
  });
  expect(downloadToTempFile).toHaveBeenCalledWith(override[0].url, undefined, 8 * 1024 * 1024);
  expect(failures[0].code).toBe("photo_dimensions_unavailable");
  expect(unlink).toHaveBeenCalledTimes(1);
});
it("skips other platforms and videos", async () => {
  await validateInstagramPhotoDimensions({ media, accounts: [{ id: "x", platform: "x" }] });
  await validateInstagramPhotoDimensions({ media: [{ ...media[0], type: "video" }], accounts });
  expect(downloadToTempFile).not.toHaveBeenCalled();
});

it("rejects overly wide images", async () => {
  metadata.mockResolvedValue({ width: 2000, height: 1000 });
  const failures = await validateInstagramPhotoDimensions({ media, accounts });
  expect(failures[0].code).toBe("photo_aspect_ratio_unsupported");
});
it("uses EXIF display orientation", async () => {
  metadata.mockResolvedValue({ width: 1080, height: 864, orientation: 6 });
  expect(await validateInstagramPhotoDimensions({ media, accounts })).toEqual([]);
  metadata.mockResolvedValue({ width: 1080, height: 540, orientation: 6 });
  const failures = await validateInstagramPhotoDimensions({ media, accounts });
  expect(failures[0].code).toBe("photo_aspect_ratio_unsupported");
});
it("identifies both failing photos in the incident carousel", async () => {
  const carousel = Array.from({ length: 5 }, (_, i) => ({ ...media[0], url: `https://example.com/${i}.jpg` }));
  for (const width of [864, 540, 540, 864, 864]) metadata.mockResolvedValueOnce({ width, height: 1080 });
  const failures = await validateInstagramPhotoDimensions({ media: carousel, accounts });
  expect(failures.map((f) => f.field)).toEqual(["text.media[1]", "text.media[2]"]);
});
