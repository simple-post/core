"use client";

import { useEffect, useMemo, useState } from "react";

import { PostPreview, type PostPreviewData, type PreviewMedia } from "@simple-post/preview-react";
import { Plus } from "lucide-react";

import { PlatformIcon } from "@/components/platform-icons";
import { getAccountDisplayName, getPlatformById } from "@/lib/config";
import { getUniquePreviewPlatformIds, normalizePreviewPlatform, PREVIEW_FRAME_SIZE } from "@/lib/platform-preview";
import { cn } from "@/lib/utils";
import type { AccountOptionsMap, ConnectedAccount, MediaFile, ThreadSegment } from "@/types";

interface PlatformPostPreviewProps {
  message: string;
  media: MediaFile[];
  selectedAccounts: ConnectedAccount[];
  accountOptions?: AccountOptionsMap;
  accountOverrides?: PreviewAccountOverridesMap;
  thread?: ThreadSegment[];
}

interface PreviewAccountOverride {
  enabled?: boolean;
  message?: string;
  media?: MediaFile[];
}

type PreviewAccountOverridesMap = Record<string, PreviewAccountOverride>;

function previewProfilePicture(account: ConnectedAccount, platform: string): string | null {
  if (!account.profilePicture) return null;
  if (platform !== "x" && platform !== "linkedin") return account.profilePicture;
  return `/api/v1/accounts/${encodeURIComponent(account.id)}/avatar?v=${encodeURIComponent(String(account.updatedAt))}`;
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

export function PlatformPostPreview({
  message,
  media,
  selectedAccounts,
  accountOptions = {},
  accountOverrides = {},
  thread = [],
}: PlatformPostPreviewProps) {
  const platformAccounts = useMemo(() => {
    const platforms = getUniquePreviewPlatformIds(selectedAccounts.map((account) => account.platform));
    return platforms.flatMap((platform) => {
      const account = selectedAccounts.find((candidate) => normalizePreviewPlatform(candidate.platform) === platform);
      return account ? [account] : [];
    });
  }, [selectedAccounts]);

  const firstPlatform = platformAccounts[0] ? normalizePreviewPlatform(platformAccounts[0].platform) : "";
  const [activePlatform, setActivePlatform] = useState(firstPlatform);
  const [previewDate] = useState(() => new Date());

  useEffect(() => {
    if (!firstPlatform) {
      if (activePlatform) setActivePlatform("");
      return;
    }
    if (!platformAccounts.some((account) => normalizePreviewPlatform(account.platform) === activePlatform)) {
      setActivePlatform(firstPlatform);
    }
  }, [activePlatform, firstPlatform, platformAccounts]);

  const activeAccount =
    platformAccounts.find((account) => normalizePreviewPlatform(account.platform) === activePlatform) ||
    platformAccounts[0];
  const platform = activeAccount ? normalizePreviewPlatform(activeAccount.platform) : "";
  const override = activeAccount ? accountOverrides[activeAccount.id] : undefined;
  const overrideEnabled = override ? (override.enabled ?? true) : false;
  const effectiveMessage = overrideEnabled && typeof override?.message === "string" ? override.message : message;
  const effectiveMedia = overrideEnabled && Array.isArray(override?.media) ? override.media : media;
  const options = useMemo(
    () => (activeAccount ? accountOptions[activeAccount.id] : undefined) || {},
    [accountOptions, activeAccount],
  );
  const platformConfig = platform ? getPlatformById(platform) : undefined;

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
      thread: thread.map((segment) => ({
        message: segment.message,
        media: toPreviewMedia(segment.media || []),
      })),
      previewDate,
    };
  }, [activeAccount, effectiveMedia, effectiveMessage, options, platform, previewDate, thread]);

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

      {platformAccounts.length > 0 ? (
        <div className="flex flex-wrap items-center justify-center gap-2" role="tablist" aria-label="Preview platform">
          {platformAccounts.map((account) => {
            const accountPlatform = normalizePreviewPlatform(account.platform);
            const config = getPlatformById(accountPlatform);
            const active = accountPlatform === platform;
            return (
              <button
                key={accountPlatform}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`Preview ${config?.name || accountPlatform}`}
                title={config?.name || accountPlatform}
                data-testid={`preview-platform-${accountPlatform}`}
                onClick={() => setActivePlatform(accountPlatform)}
                className={cn(
                  "flex size-10 items-center justify-center rounded-full border-2 text-white shadow-sm transition-transform hover:-translate-y-0.5",
                  config?.color || "bg-neutral-600",
                  active
                    ? "border-foreground ring-2 ring-foreground/15"
                    : "border-background opacity-65 hover:opacity-100",
                )}>
                <PlatformIcon platform={accountPlatform} className="size-4" />
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="overflow-x-auto pb-1">
        <div
          data-testid="post-preview-frame"
          className="mx-auto shrink-0 overflow-hidden bg-neutral-950"
          style={{ width: PREVIEW_FRAME_SIZE.width }}>
          <div data-testid={`platform-preview-${platform || "empty"}`} className="overflow-hidden bg-neutral-950">
            {previewData ? (
              <PostPreview data={previewData} />
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 bg-neutral-950 px-8 text-center">
                <div className="flex size-14 items-center justify-center rounded-full border border-dashed border-neutral-700 bg-neutral-900">
                  <Plus className="size-5 text-neutral-400" />
                </div>
                <p className="text-sm font-semibold text-neutral-100">Select an account</p>
                <p className="text-xs leading-5 text-neutral-400">
                  Your post will be rendered here as it appears on that platform.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
