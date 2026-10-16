import fs from "node:fs";

import { getKeyFromUrl } from "./s3";

import type { Media } from "../types/post";

// Internal provenance survives object spreads, but cannot arrive through JSON.
// A caller-provided path always wins over an unrelated URL on the same item.
const downloadedSource = Symbol("downloaded-media-source");
type DownloadedMedia = Media & {
  [downloadedSource]?: { path: string; url: string; size: number; mtimeMs: number };
};

export function rememberDownloadedSource(media: Media): void {
  if (media.type !== "video" || !media.path || !media.url || !getKeyFromUrl(media.url)?.startsWith("uploads/")) return;
  const { size, mtimeMs } = fs.statSync(media.path);
  (media as DownloadedMedia)[downloadedSource] = { path: media.path, url: media.url, size, mtimeMs };
}

/** Only permanent managed uploads are eligible; temporary copies may be cleaned up after a timeout. */
export function getDownloadedSourceUrl(media: Media): string | undefined {
  const source = (media as DownloadedMedia)[downloadedSource];
  if (!source || source.path !== media.path || source.url !== media.url) return;
  const { size, mtimeMs } = fs.statSync(source.path);
  if (size === source.size && mtimeMs === source.mtimeMs) return source.url;
}
