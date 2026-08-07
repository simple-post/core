import { getRemoteMediaSize } from "./media";

import { mapPlatformName } from "../platform-names";
import { YOUTUBE_MAX_THUMBNAIL_SIZE_BYTES } from "../publishers/youtube/validation";
import { isThreadCapablePlatform } from "../types/api";
import { getValidationRulesForPlatform } from "../validation";

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
}

function collectMediaUsages(params: RemoteMediaValidationParams): MediaUsage[] {
  const usages: MediaUsage[] = [];
  const sharedThread = params.thread ?? [];

  for (const account of params.accounts) {
    const platform = mapPlatformName(account.platform);
    const override = params.accountOverrides?.[account.id];
    const rootMedia = override?.media ?? params.media;
    const rules = getValidationRulesForPlatform(platform);

    for (const [index, media] of rootMedia.entries()) {
      if (rules[media.type]?.maxSizeBytes !== undefined) {
        usages.push({ url: media.url, media, accountId: account.id, platform, field: `text.media[${index}]` });
      }
    }

    if (platform === "youtube") {
      const videoIndex = rootMedia.findIndex((media) => media.type === "video");
      const video = videoIndex === -1 ? undefined : rootMedia[videoIndex];
      const optionThumbnail = params.accountOptions?.[account.id]?.thumbnailUrl;
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
          maxSizeBytes: YOUTUBE_MAX_THUMBNAIL_SIZE_BYTES,
        });
      }
    }

    if (!isThreadCapablePlatform(platform)) continue;
    for (const [segmentIndex, segment] of (override?.thread ?? sharedThread).entries()) {
      for (const [mediaIndex, media] of (segment.media ?? []).entries()) {
        if (rules[media.type]?.maxSizeBytes !== undefined) {
          usages.push({
            url: media.url,
            media,
            accountId: account.id,
            platform,
            field: `thread[${segmentIndex}].media[${mediaIndex}]`,
          });
        }
      }
    }
  }

  return usages;
}

/**
 * Replaces untrusted caller-provided sizes with sizes measured at the media
 * origin, returning structured errors for origins that cannot be inspected.
 * URLs shared by multiple accounts or content locations are fetched once.
 */
export async function hydrateRemoteMediaSizesForAccounts(
  params: RemoteMediaValidationParams,
): Promise<ValidationIssue[]> {
  const usagesByUrl = new Map<string, MediaUsage[]>();

  for (const usage of collectMediaUsages(params)) {
    const matching = usagesByUrl.get(usage.url) ?? [];
    matching.push(usage);
    usagesByUrl.set(usage.url, matching);
  }

  const failures = await Promise.all(
    [...usagesByUrl.entries()].map(async ([url, matchingUsages]) => {
      try {
        const measuredSize = await getRemoteMediaSize(url);
        const oversized: ValidationIssue[] = [];
        for (const usage of matchingUsages) {
          if (usage.media) usage.media.size = measuredSize;
          if (usage.maxSizeBytes !== undefined && measuredSize > usage.maxSizeBytes) {
            oversized.push({
              platform: usage.platform,
              severity: "error",
              code: "thumbnail_too_large",
              message: "YouTube custom thumbnails cannot exceed 2 MB.",
              field: usage.field,
              limit: usage.maxSizeBytes,
              actual: measuredSize,
              meta: { accountId: usage.accountId },
            });
          }
        }
        return oversized;
      } catch {
        return matchingUsages.map(
          ({ accountId, platform, field }): ValidationIssue => ({
            platform,
            severity: "error",
            code: "media_size_unavailable",
            message: "SimplePost couldn't determine this media file's size. Check that its URL is publicly accessible.",
            field,
            meta: { accountId },
          }),
        );
      }
    }),
  );

  const uniqueFailures = new Map<string, ValidationIssue>();
  for (const failure of failures.flat()) {
    const accountId = String(failure.meta?.accountId ?? "");
    uniqueFailures.set(`${accountId}:${failure.platform}:${failure.field}`, failure);
  }

  return [...uniqueFailures.values()];
}
