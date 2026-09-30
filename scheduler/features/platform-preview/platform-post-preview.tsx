"use client";

import { useMemo, useState } from "react";

import { type PostPreviewData, type PreviewMedia } from "@simple-post/preview-react";

import { PreviewSwitcher } from "@/components/visual/preview-switcher";
import { getAccountDisplayName, getPlatformById } from "@/lib/config";
import { normalizePreviewPlatform, type PreviewPlatform } from "@/lib/platform-preview";
import type { AccountOptionsMap, ConnectedAccount, MediaFile, ThreadSegment } from "@/types";

interface PlatformPostPreviewProps {
  message: string;
  media: MediaFile[];
  selectedAccounts: ConnectedAccount[];
  accountOptions?: AccountOptionsMap;
  accountOverrides?: PreviewAccountOverridesMap;
  thread?: ThreadSegment[];
  /** When the post goes out, shown as the post's timestamp. Defaults to now. */
  previewDate?: Date | null;
}

interface PreviewAccountOverride {
  enabled?: boolean;
  message?: string;
  media?: MediaFile[];
  thread?: ThreadSegment[];
}

type PreviewAccountOverridesMap = Record<string, PreviewAccountOverride>;

interface PlatformAccount {
  platform: PreviewPlatform;
  account: ConnectedAccount;
}

function previewProfilePicture(account: ConnectedAccount, platform: string): string | null {
  if (platform === "linkedin" || platform === "threads" || (platform === "x" && account.profilePicture)) {
    return `/api/v1/accounts/${encodeURIComponent(account.id)}/avatar?v=${encodeURIComponent(String(account.updatedAt))}`;
  }
  return account.profilePicture;
}

function toPreviewMedia(media: MediaFile[]): PreviewMedia[] {
  return media.map((file) => ({
    id: file.id,
    type: file.type,
    url: file.url,
    thumbnailUrl: file.thumbnailUrl,
    filename: file.filename,
  }));
}

/**
 * Live preview of the composed post as it will appear on each selected
 * platform. Rendering is delegated to `@simple-post/preview-react`; this
 * component owns platform selection, per-account overrides, and the frame
 * around the render.
 */
export function PlatformPostPreview({
  message,
  media,
  selectedAccounts,
  accountOptions = {},
  accountOverrides = {},
  thread = [],
  previewDate: publishDate,
}: PlatformPostPreviewProps) {
  const platformAccounts = useMemo<PlatformAccount[]>(() => {
    const seen = new Set<PreviewPlatform>();
    const result: PlatformAccount[] = [];
    for (const account of selectedAccounts) {
      const platform = normalizePreviewPlatform(account.platform);
      if (platform && !seen.has(platform)) {
        seen.add(platform);
        result.push({ platform, account });
      }
    }
    return result;
  }, [selectedAccounts]);

  const [selectedPlatform, setSelectedPlatform] = useState<PreviewPlatform | null>(null);
  const [now] = useState(() => new Date());
  const previewDate = publishDate ?? now;

  const active = platformAccounts.find((entry) => entry.platform === selectedPlatform) ?? platformAccounts[0];
  const platform = active?.platform;
  const activeAccount = active?.account;
  const platformConfig = platform ? getPlatformById(platform) : undefined;

  const override = activeAccount ? accountOverrides[activeAccount.id] : undefined;
  const overrideEnabled = override ? (override.enabled ?? true) : false;
  const effectiveMessage = overrideEnabled && typeof override?.message === "string" ? override.message : message;
  const effectiveMedia = overrideEnabled && Array.isArray(override?.media) ? override.media : media;
  const effectiveThread = overrideEnabled && Array.isArray(override?.thread) ? override.thread : thread;
  const options = useMemo(
    () => (activeAccount ? accountOptions[activeAccount.id] : undefined) || {},
    [accountOptions, activeAccount],
  );

  const previewData = useMemo<PostPreviewData | undefined>(() => {
    if (!activeAccount || !platform) return undefined;
    return {
      platform,
      account: {
        id: activeAccount.id,
        platform,
        displayName: activeAccount.displayName || getAccountDisplayName(activeAccount),
        username: activeAccount.username,
        profilePicture: previewProfilePicture(activeAccount, platform),
      },
      message: effectiveMessage,
      media: toPreviewMedia(effectiveMedia),
      options,
      thread: effectiveThread.map((segment) => ({
        message: segment.message,
        media: toPreviewMedia(segment.media || []),
      })),
      threadLayout: "expand",
      previewDate,
    };
  }, [activeAccount, effectiveMedia, effectiveMessage, effectiveThread, options, platform, previewDate]);

  return (
    <section className="space-y-3" aria-label="Post preview">
      <div className="flex items-center justify-between">
        <div className="section-kicker">
          <span className="section-kicker-dot" />
          <span className="section-kicker-label">Platform preview</span>
        </div>
        {platformConfig ? (
          <span className="text-xs font-medium text-muted-foreground">{platformConfig.name}</span>
        ) : null}
      </div>

      <PreviewSwitcher
        items={platformAccounts.map((entry) => ({
          id: entry.platform,
          platform: entry.platform,
          platformLabel: getPlatformById(entry.platform)?.name ?? entry.platform,
          accountLabel: getAccountDisplayName(entry.account),
          accessibleLabel: `Preview ${getPlatformById(entry.platform)?.name ?? entry.platform}`,
          data: entry.platform === platform ? previewData : undefined,
        }))}
        selectedId={platform ?? null}
        onSelect={(id) => setSelectedPlatform(id as PreviewPlatform)}
      />
    </section>
  );
}
