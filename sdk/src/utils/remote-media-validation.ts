import { mediaFormatFailure } from "./media-format-validation";
import { inspectRemoteMedia, MediaInspectionError } from "./media-inspection";

import { mapPlatformName } from "../platform-names";
import { YOUTUBE_MAX_THUMBNAIL_SIZE_BYTES } from "../publishers/youtube/validation";
import { isThreadCapablePlatform } from "../types/api";
import { validateInspectedMedia } from "../validation/media-rules";

import type { AccountOptionsMap, AccountOverridesMap, MediaFile, ThreadSegment } from "../types/api";
import type { Platform } from "../types/post";
import type { ValidationIssue } from "../types/validation";

export interface RemoteMediaValidationAccount {
  id: string;
  platform: string;
}

export interface RemoteMediaValidationParams {
  media: MediaFile[];
  accounts: RemoteMediaValidationAccount[];
  accountOptions?: AccountOptionsMap;
  accountOverrides?: AccountOverridesMap;
  thread?: ThreadSegment[];
}

interface MediaUsage {
  url: string;
  media?: MediaFile;
  accountId: string;
  platform: Platform;
  field: string;
  maxSizeBytes?: number;
  mediaCount?: number;
}

function collectMediaUsages(params: RemoteMediaValidationParams): MediaUsage[] {
  const usages: MediaUsage[] = [];
  const sharedThread = params.thread ?? [];

  for (const account of params.accounts) {
    const platform = mapPlatformName(account.platform);
    const override = params.accountOverrides?.[account.id];
    const rootMedia = override?.media ?? params.media;

    for (const [index, media] of rootMedia.entries()) {
      usages.push({
        url: media.url,
        media,
        accountId: account.id,
        platform,
        field: `text.media[${index}]`,
        mediaCount: rootMedia.length,
      });
    }

    if (platform === "youtube" || platform === "pinterest") {
      const videoIndex = rootMedia.findIndex((media) => media.type === "video");
      const video = videoIndex === -1 ? undefined : rootMedia[videoIndex];
      const optionThumbnail = platform === "youtube" ? params.accountOptions?.[account.id]?.thumbnailUrl : undefined;
      const thumbnailUrl = typeof optionThumbnail === "string" ? optionThumbnail : video?.thumbnailUrl;
      if (thumbnailUrl) {
        usages.push({
          url: thumbnailUrl,
          accountId: account.id,
          platform,
          field:
            typeof optionThumbnail === "string"
              ? `accountOptions.${account.id}.thumbnailUrl`
              : `text.media[${videoIndex}].thumbnailUrl`,
          maxSizeBytes: platform === "youtube" ? YOUTUBE_MAX_THUMBNAIL_SIZE_BYTES : 20 * 1024 * 1024,
        });
      }
    }

    if (!isThreadCapablePlatform(platform)) continue;
    for (const [segmentIndex, segment] of (override?.thread ?? sharedThread).entries()) {
      for (const [mediaIndex, media] of (segment.media ?? []).entries()) {
        usages.push({
          url: media.url,
          media,
          accountId: account.id,
          platform,
          field: `thread[${segmentIndex}].media[${mediaIndex}]`,
          mediaCount: (segment.media ?? []).length,
        });
      }
    }
  }

  return usages;
}

/**
 * Validates accessibility, real file bytes and per-platform image formats,
 * replacing untrusted caller sizes with measured sizes. Runs before saving or publishing.
 * URLs shared by multiple accounts or content locations are fetched once.
 */
export async function hydrateRemoteMediaSizesForAccounts(
  params: RemoteMediaValidationParams,
): Promise<ValidationIssue[]> {
  const usagesByUrl = new Map<string, MediaUsage[]>();

  for (const usage of collectMediaUsages(params)) {
    const key = usage.platform === "tiktok" && usage.media?.type === "image" ? `direct:${usage.url}` : usage.url;
    const matching = usagesByUrl.get(key) ?? [];
    matching.push(usage);
    usagesByUrl.set(key, matching);
  }

  const entries = [...usagesByUrl.entries()];
  const failures: ValidationIssue[][] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, entries.length) }, async () => {
      while (next < entries.length) {
        const [key, matchingUsages] = entries[next++];
        const url = matchingUsages[0].url;
        failures.push(
          await (async () => {
            try {
              const inspection = await inspectRemoteMedia(
                url,
                key.startsWith("direct:") ? { maxRedirects: 0 } : undefined,
              );
              const measuredSize = inspection.size;
              const oversized: ValidationIssue[] = [];
              for (const usage of matchingUsages) {
                if (usage.media) {
                  usage.media.size = measuredSize;
                  usage.media.contentType = inspection.contentType;
                  if (usage.media.type === "video") usage.media.durationSec = inspection.video?.durationSec;
                }
                oversized.push(
                  ...validateInspectedMedia(usage.platform, inspection, {
                    mediaCount: usage.mediaCount ?? 1,
                    thumbnail: !usage.media,
                  }).map((issue) => ({ ...issue, field: usage.field, meta: { accountId: usage.accountId } })),
                );
                const formatFailure = mediaFormatFailure(inspection, usage.platform, usage.media?.type ?? "image");
                if (formatFailure)
                  oversized.push({
                    ...formatFailure,
                    platform: usage.platform,
                    severity: "error",
                    field: usage.field,
                    meta: { accountId: usage.accountId },
                  });
                if (usage.maxSizeBytes !== undefined && measuredSize > usage.maxSizeBytes) {
                  oversized.push({
                    platform: usage.platform,
                    severity: "error",
                    code: "thumbnail_too_large",
                    message: `${usage.platform} cover image exceeds the ${usage.maxSizeBytes / (1024 * 1024)} MB limit.`,
                    field: usage.field,
                    limit: usage.maxSizeBytes,
                    actual: measuredSize,
                    meta: { accountId: usage.accountId },
                  });
                }
              }
              return oversized;
            } catch (error) {
              return matchingUsages.map(
                ({ accountId, platform, field }): ValidationIssue => ({
                  platform,
                  severity: "error",
                  code: error instanceof MediaInspectionError ? error.code : "media_unavailable",
                  message:
                    error instanceof MediaInspectionError
                      ? error.message
                      : "SimplePost couldn't inspect this media. Upload the file directly or use a publicly accessible URL.",
                  field,
                  meta: { accountId },
                }),
              );
            }
          })(),
        );
      }
    }),
  );

  const uniqueFailures = new Map<string, ValidationIssue>();
  for (const failure of failures.flat()) {
    const accountId = String(failure.meta?.accountId ?? "");
    uniqueFailures.set(`${accountId}:${failure.platform}:${failure.field}:${failure.code}`, failure);
  }

  return [...uniqueFailures.values()];
}
