import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { LiveConfig } from "./config.js";
import type { MediaKey, MediaFile } from "./types.js";
import type { SchedulerApi } from "./http.js";
export const filenames: Record<MediaKey, string> = {
  image: "image.jpg",
  image2: "image-2.jpg",
  webp: "image.webp",
  video: "video.mp4",
  silentVideo: "silent-video.mp4",
};
export async function mediaFiles(config: LiveConfig, keys: readonly MediaKey[]): Promise<MediaFile[]> {
  return Promise.all(
    keys.map(async (key) => {
      const filename = filenames[key],
        file = path.join(config.fixtureDir, filename),
        bytes = await readFile(file);
      return {
        filename,
        path: file,
        url: config.fixtureUrls[filename] ?? new URL(filename, config.mediaBaseUrl.replace(/\/?$/, "/")).href,
        type: key === "video" || key === "silentVideo" ? "video" : "image",
        size: bytes.length,
        ...(key === "video" || key === "silentVideo"
          ? {
              thumbnailUrl:
                config.fixtureUrls["image.jpg"] ?? new URL("image.jpg", config.mediaBaseUrl.replace(/\/?$/, "/")).href,
            }
          : {}),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        ...(filename.endsWith(".mp4") ? { durationSec: 4 } : {}),
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
      const uploaded = await api.upload(file);
      const url = new URL(uploaded.url);
      if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))
        throw new Error("Unexpected fixture upload URL");
      if (uploaded.size !== file.size) throw new Error("Fixture upload changed the file size");
      config.fixtureUrls[file.filename] = uploaded.url;
      file.url = uploaded.url;
      await mkdir(path.dirname(config.mediaManifestFile), { recursive: true, mode: 0o700 });
      await writeFile(
        config.mediaManifestFile + ".tmp",
        JSON.stringify({ baseUrl: config.baseUrl, userId: config.userId, urls: config.fixtureUrls }, null, 2),
        { mode: 0o600 },
      );
      await rename(config.mediaManifestFile + ".tmp", config.mediaManifestFile);
    }
    const response = await fetch(file.url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Fixture ${file.filename} is not publicly accessible (${response.status})`);
    const bytes = await response.arrayBuffer();
    if (createHash("sha256").update(Buffer.from(bytes)).digest("hex") !== file.sha256)
      throw new Error(`Hosted fixture ${file.filename} does not match the local fixture`);
  }
  return files;
}
