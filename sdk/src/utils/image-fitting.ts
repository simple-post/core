import { randomUUID } from "node:crypto";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import sharp from "sharp";

import { downloadToTempFile } from "./media";
import { mediaFormatFailure } from "./media-format-validation";
import { inspectLocalMedia } from "./media-inspection";
import { generateFileKey, S3MediaUploader } from "./s3";

import { ImageFitSchema } from "../image-fit";
import { mapPlatformName } from "../platform-names";
import { isThreadCapablePlatform } from "../types/api";
import { getValidationRulesForPlatform, validateContentForPlatform } from "../validation";
import { validateInspectedMedia } from "../validation/media-rules";

import type { ImageFit } from "../image-fit";
import type { MediaInspection } from "./media-inspection";
import type { AccountOptionsMap, AccountOverridesMap, MediaFile, ThreadSegment } from "../types/api";
import type { Platform, Post } from "../types/post";

const MAX_INPUT_BYTES = 32 * 1024 * 1024;

/** Produces a new still JPEG only when needed. Source files are never overwritten. */
export async function fitImage(
  source: { path?: string; url?: string },
  platforms: Platform[],
  mode: ImageFit,
  context: { mediaCount?: number; thumbnail?: boolean } = {},
): Promise<{ bytes: Buffer; width: number; height: number; flattened: boolean } | undefined> {
  ImageFitSchema.parse(mode);
  if (platforms.length === 0) return;
  const downloaded =
    !source.path && source.url ? await downloadToTempFile(source.url, undefined, MAX_INPUT_BYTES) : undefined;
  const inputPath = source.path ?? downloaded;
  if (!inputPath) throw new Error("An image path or public URL is required.");
  try {
    const sourceStat = await stat(inputPath);
    if (sourceStat.size > MAX_INPUT_BYTES) throw new Error("Image fitting accepts files up to 32 MB.");
    const inspection = await inspectLocalMedia(inputPath);
    if (!inspection.contentType.startsWith("image/")) throw new Error("Image fitting requires an image.");
    const mediaCount = context.mediaCount ?? 1;
    const maxBytes = Math.min(
      MAX_INPUT_BYTES,
      ...platforms.map((platform) =>
        context.thumbnail && platform === "youtube"
          ? 2 * 1024 * 1024
          : (getValidationRulesForPlatform(platform).image?.maxSizeBytes ?? MAX_INPUT_BYTES),
      ),
    );
    const invalid = (value: MediaInspection) =>
      platforms.some(
        (platform) =>
          mediaFormatFailure(value, platform, "image") ||
          validateInspectedMedia(platform, value, { mediaCount, thumbnail: context.thumbnail }).some(
            (issue) => issue.severity === "error",
          ) ||
          (context.thumbnail
            ? value.size > maxBytes
            : validateContentForPlatform(platform, {
                text: "Image",
                media: [{ type: "image", path: inputPath, size: value.size, contentType: value.contentType }],
              }).errors.some((issue) => issue.code === "image_too_large")),
      );
    // A misleading filename also fails TikTok's source check even when the bytes are supported.
    const badTikTokExtension =
      platforms.includes("tiktok") &&
      /\.(?!jpe?g$|webp$)[a-z0-9]+$/i.test(new URL(source.url ?? "file:///" + inputPath).pathname);
    if (!invalid(inspection) && !badTikTokExtension) return;

    const original = await readFile(inputPath);
    let minRatio = 0;
    let maxRatio = Infinity;
    if (platforms.includes("telegram")) {
      minRatio = 0.05;
      maxRatio = 20;
    }
    if (platforms.includes("instagram")) {
      minRatio = 0.8;
      maxRatio = 1.91;
    }
    const originalRatio = inspection.width! / inspection.height!;
    const ratio = Math.max(minRatio, Math.min(maxRatio, originalRatio));
    let width = inspection.width!;
    let height = inspection.height!;
    if (mode === "crop") {
      if (originalRatio < ratio) height = Math.floor(width / ratio);
      else width = Math.floor(height * ratio);
    } else {
      if (originalRatio < ratio) width = Math.ceil(height * ratio);
      else height = Math.ceil(width / ratio);
    }
    const pixelLimit = platforms.includes("linkedin") ? 36_152_319 : 40_000_000;
    let scale = Math.min(1, Math.sqrt(pixelLimit / (width * height)));
    if (platforms.includes("telegram")) scale = Math.min(scale, 10_000 / (width + height));
    if (platforms.includes("tiktok"))
      scale = Math.min(scale, 1080 / Math.min(width, height), 1920 / Math.max(width, height));
    // Round inward to the ratio interval, including after downscaling.
    const dimensions = () => {
      let w = Math.max(1, Math.floor(width * scale));
      let h = Math.max(1, Math.floor(height * scale));
      if (w / h < minRatio) h = Math.max(1, Math.floor(w / minRatio));
      if (w / h > maxRatio) w = Math.max(1, Math.floor(h * maxRatio));
      return { width: w, height: h };
    };
    for (let attempt = 0; attempt < 12; attempt++) {
      const size = dimensions();
      const image = () => sharp(original, { failOn: "warning", limitInputPixels: 40_000_000 }).rotate();
      let canvas: Buffer;
      if (mode === "blur" && originalRatio !== ratio) {
        const background = await image()
          .resize({ ...size, fit: "cover" })
          .blur(24)
          .flatten({ background: "#ffffff" })
          .toBuffer();
        const foreground = await image()
          .resize({ ...size, fit: "inside" })
          .png()
          .toBuffer();
        canvas = await sharp(background)
          .composite([{ input: foreground, gravity: "centre" }])
          .png()
          .toBuffer();
      } else {
        canvas = await image()
          .resize({ ...size, fit: "cover", position: "centre" })
          .flatten({ background: "#ffffff" })
          .png()
          .toBuffer();
      }
      for (const quality of [90, 80, 70, 60]) {
        const bytes = await sharp(canvas).jpeg({ quality, mozjpeg: true }).toBuffer();
        const result: MediaInspection = { ...size, size: bytes.length, contentType: "image/jpeg", frames: 1 };
        if (bytes.length <= maxBytes && !invalid(result))
          return { bytes, ...size, flattened: (inspection.frames ?? 1) > 1 };
      }
      scale *= 0.8;
    }
    throw new Error("Could not fit this image within the selected platforms' limits. Choose a smaller image.");
  } finally {
    if (downloaded) await unlink(downloaded).catch(() => {});
  }
}

/** Fits local SDK/CLI input to the intersection of selected platform requirements. */
export async function fitPostImages(post: Post, mode: ImageFit): Promise<{ post: Post; cleanup: () => Promise<void> }> {
  const files: string[] = [];
  const cleanup = async () => {
    await Promise.all(files.map((file) => unlink(file).catch(() => {})));
  };
  try {
    const content = { ...post.content, media: post.content.media ? [...post.content.media] : undefined };
    const save = async (result: NonNullable<Awaited<ReturnType<typeof fitImage>>>) => {
      const file = path.join(os.tmpdir(), `simplepost-fit-${randomUUID()}.jpg`);
      files.push(file);
      await writeFile(file, result.bytes);
      return file;
    };
    for (const [index, media] of (content.media ?? []).entries()) {
      if (media.type === "video") {
        const targets = post.platforms.filter((platform) => platform === "youtube" || platform === "pinterest");
        if (targets.length > 0 && (media.thumbnailPath || media.thumbnailUrl)) {
          const result = await fitImage({ path: media.thumbnailPath, url: media.thumbnailUrl }, targets, mode, {
            thumbnail: true,
          });
          if (result) content.media![index] = { ...media, thumbnailPath: await save(result), thumbnailUrl: undefined };
        }
        continue;
      }
      const result = await fitImage(media, post.platforms, mode, { mediaCount: content.media!.length });
      if (!result) continue;
      const file = await save(result);
      content.media![index] = {
        ...media,
        url: undefined,
        path: file,
        size: result.bytes.length,
        contentType: "image/jpeg",
      };
    }
    let options = post.options;
    if (post.platforms.includes("youtube") && (options?.youtube?.thumbnailPath || options?.youtube?.thumbnailUrl)) {
      const result = await fitImage(
        { path: options.youtube.thumbnailPath, url: options.youtube.thumbnailUrl },
        ["youtube"],
        mode,
        { thumbnail: true },
      );
      if (result)
        options = {
          ...options,
          youtube: { ...options.youtube, thumbnailPath: await save(result), thumbnailUrl: undefined },
        };
    }
    return { post: { ...post, content, options, imageFit: undefined }, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export interface ImageFitContent {
  media: MediaFile[];
  accountOverrides?: AccountOverridesMap;
  accountOptions?: AccountOptionsMap;
  thread?: ThreadSegment[];
}

/** Mutates only after all transformations succeed; callers persist the returned URLs, never originals. */
export async function fitRemoteImagesForAccounts(
  content: ImageFitContent,
  accounts: { id: string; platform: string }[],
  mode: ImageFit,
  userId: string,
  onUploaded?: (url: string) => Promise<void>,
): Promise<void> {
  ImageFitSchema.parse(mode);
  const prepared = structuredClone(content);
  let uploader: S3MediaUploader | undefined;
  const uploaded: string[] = [];
  const cache = new Map<string, string>();
  const fit = async (url: string, platforms: Platform[], mediaCount: number, thumbnail = false) => {
    const key = JSON.stringify([url, [...platforms].sort(), mediaCount, thumbnail]);
    if (cache.has(key)) return cache.get(key)!;
    const result = await fitImage({ url }, platforms, mode, { mediaCount, thumbnail });
    if (!result) return url;
    uploader ??= new S3MediaUploader();
    const storageKey = generateFileKey(userId, "fitted-image.jpg");
    const fittedUrl = await uploader.uploadStream(Readable.from(result.bytes), storageKey, "image/jpeg");
    uploaded.push(storageKey);
    await onUploaded?.(fittedUrl);
    cache.set(key, fittedUrl);
    return fittedUrl;
  };
  const fitMedia = async (media: MediaFile[] | undefined, targets: typeof accounts) => {
    const platforms = [...new Set(targets.map((account) => mapPlatformName(account.platform)))];
    if (platforms.length === 0) return;
    for (const item of media ?? []) {
      if (item.type === "image") {
        const url = await fit(item.url, platforms, media!.length);
        if (url !== item.url)
          Object.assign(item, {
            url,
            id: randomUUID(),
            filename: "fitted-image.jpg",
            contentType: "image/jpeg",
            size: 0,
            thumbnailUrl: undefined,
          });
      } else if (item.thumbnailUrl) {
        const thumbnailPlatforms = platforms.filter((platform) => platform === "youtube" || platform === "pinterest");
        if (thumbnailPlatforms.length > 0)
          item.thumbnailUrl = await fit(item.thumbnailUrl, thumbnailPlatforms, 1, true);
      }
    }
  };
  try {
    await fitMedia(
      prepared.media,
      accounts.filter((account) => !prepared.accountOverrides?.[account.id]?.media),
    );
    for (const segment of prepared.thread ?? [])
      await fitMedia(
        segment.media,
        accounts.filter(
          (account) =>
            isThreadCapablePlatform(mapPlatformName(account.platform)) &&
            !prepared.accountOverrides?.[account.id]?.thread,
        ),
      );
    for (const account of accounts) {
      const override = prepared.accountOverrides?.[account.id];
      await fitMedia(override?.media, [account]);
      if (isThreadCapablePlatform(mapPlatformName(account.platform)))
        for (const segment of override?.thread ?? []) await fitMedia(segment.media, [account]);
      const options = prepared.accountOptions?.[account.id];
      if (account.platform === "youtube" && typeof options?.thumbnailUrl === "string")
        options.thumbnailUrl = await fit(options.thumbnailUrl, ["youtube"], 1, true);
    }
    content.media.splice(0, content.media.length, ...prepared.media);
    if (content.thread && prepared.thread) content.thread.splice(0, content.thread.length, ...prepared.thread);
    if (content.accountOverrides) Object.assign(content.accountOverrides, prepared.accountOverrides);
    if (content.accountOptions) Object.assign(content.accountOptions, prepared.accountOptions);
  } catch (error) {
    await Promise.all(uploaded.map((key) => uploader!.deleteFile(key).catch(() => {})));
    throw error;
  }
}
