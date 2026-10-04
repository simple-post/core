import { open, stat, mkdir, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { BigIntStats } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import type { LiveConfig } from "./config.js";
import type { MediaKey, MediaFile } from "./types.js";
import type { SchedulerApi } from "./http.js";
export const filenames: Record<MediaKey, string> = {
  fitPortrait: "fit-portrait.jpg",
  fitNoise: "fit-noise.jpg",
  narrowImage: "narrow-image.jpg",
  largeImage: "large-image.jpg",
  squareVideo: "square-video.mp4",
  shortVideo: "short-video.mp4",
  slowVideo: "slow-video.mp4",
  disguisedVideo: "disguised-video.mp4",
  image: "image.jpg",
  image2: "image-2.jpg",
  webp: "image.webp",
  video: "video.mp4",
  silentVideo: "silent-video.mp4",
};
export function isVideoFixture(key: MediaKey): boolean {
  return filenames[key].endsWith(".mp4");
}
type LocalMetadata = Readonly<{ size: number; sha256: string }>;
// One entry per resolved path: no URLs, account data, or mutable MediaFile objects.
const metadataCache = new Map<string, { key: string; value: Promise<LocalMetadata> }>();
function inputKey(file: string, info: BigIntStats): string {
  return JSON.stringify([file, ...[info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].map(String)]);
}
async function localMetadata(file: string): Promise<LocalMetadata> {
  const before = await stat(file, { bigint: true });
  const key = inputKey(file, before);
  const cached = metadataCache.get(file);
  if (cached?.key === key) return cached.value;
  const value = (async () => {
    const handle = await open(file, "r");
    try {
      if (inputKey(file, await handle.stat({ bigint: true })) !== key)
        throw new Error(`Fixture changed while reading: ${file}`);
      const bytes = await handle.readFile();
      // Check both the open inode and the path, including replacement during read.
      if (
        inputKey(file, await handle.stat({ bigint: true })) !== key ||
        inputKey(file, await stat(file, { bigint: true })) !== key ||
        BigInt(bytes.length) !== before.size
      )
        throw new Error(`Fixture changed while reading: ${file}`);
      return Object.freeze({ size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    } finally {
      await handle.close();
    }
  })();
  metadataCache.set(file, { key, value });
  try {
    return await value;
  } catch (error) {
    if (metadataCache.get(file)?.value === value) metadataCache.delete(file);
    throw error;
  }
}
export async function mediaFiles(config: LiveConfig, keys: readonly MediaKey[]): Promise<MediaFile[]> {
  return Promise.all(
    keys.map(async (key) => {
      const filename = filenames[key],
        file = path.resolve(config.fixtureDir, filename),
        metadata = await localMetadata(file);
      return {
        filename,
        path: file,
        url: config.fixtureUrls[filename] ?? new URL(filename, config.mediaBaseUrl.replace(/\/?$/, "/")).href,
        type: isVideoFixture(key) ? "video" : "image",
        size: metadata.size,
        ...(isVideoFixture(key)
          ? {
              thumbnailUrl:
                config.fixtureUrls["image.jpg"] ?? new URL("image.jpg", config.mediaBaseUrl.replace(/\/?$/, "/")).href,
            }
          : {}),
        sha256: metadata.sha256,
        ...(filename.endsWith(".mp4") ? { durationSec: key === "shortVideo" || key === "disguisedVideo" ? 1 : 4 } : {}),
      };
    }),
  );
}
export async function prepareMediaSources(config: LiveConfig, keys: MediaKey[], api: SchedulerApi) {
  const files = await mediaFiles(config, [...new Set(keys)]);
  for (const file of files) {
    if (new URL(file.url).hostname === "fixtures.invalid") {
      if (process.env.E2E_VERIFY_ONLY === "1") throw new Error("Verification-only mode cannot upload missing fixtures");
      if (!config.mediaManifestFile)
        throw new Error("Run e2e:setup to enable automatic fixture hosting, or configure mediaBaseUrl");
      // The disguised-container scenarios deliberately use WebM bytes with an
      // MP4 filename. Stage them with the customer-facing presigned upload
      // path so the subsequent MCP validation, rather than fixture staging,
      // reports the expected invalid-container error.
      const uploaded =
        file.filename === "disguised-video.mp4" ? await api.uploadUncheckedFixture(file) : await api.upload(file);
      const url = new URL(uploaded.url);
      if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))
        throw new Error("Unexpected fixture upload URL");
      if (uploaded.size !== file.size) throw new Error("Fixture upload changed the file size");
      config.fixtureUrls[file.filename] = uploaded.url;
      file.url = uploaded.url;
      await mkdir(path.dirname(config.mediaManifestFile), { recursive: true, mode: 0o700 });
      const temporary = `${config.mediaManifestFile}.${randomUUID()}.tmp`;
      try {
        await writeFile(
          temporary,
          JSON.stringify({ baseUrl: config.baseUrl, userId: config.userId, urls: config.fixtureUrls }, null, 2),
          { mode: 0o600, flag: "wx" },
        );
        await rename(temporary, config.mediaManifestFile);
      } finally {
        await rm(temporary, { force: true });
      }
    }
    const response = await fetch(file.url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Fixture ${file.filename} is not publicly accessible (${response.status})`);
    const bytes = await response.arrayBuffer();
    if (createHash("sha256").update(Buffer.from(bytes)).digest("hex") !== file.sha256)
      throw new Error(`Hosted fixture ${file.filename} does not match the local fixture`);
  }
  return files;
}
