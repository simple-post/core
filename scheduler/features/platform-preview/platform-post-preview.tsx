"use client";

import { useMemo, useRef, useState } from "react";

import { PostPreview, type PostPreviewData, type PreviewMedia } from "@simple-post/preview-react";
import { Plus } from "lucide-react";

import { PlatformIcon } from "@/components/platform-icons";
import { getAccountDisplayName, getPlatformById } from "@/lib/config";
import { normalizePreviewPlatform, PREVIEW_FRAME_WIDTH, type PreviewPlatform } from "@/lib/platform-preview";
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

interface PlatformAccount {
  platform: PreviewPlatform;
  account: ConnectedAccount;
}

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
  const [previewDate] = useState(() => new Date());
  const tabsRef = useRef<HTMLDivElement>(null);

  const active = platformAccounts.find((entry) => entry.platform === selectedPlatform) ?? platformAccounts[0];
  const platform = active?.platform;
  const activeAccount = active?.account;
  const platformConfig = platform ? getPlatformById(platform) : undefined;

  const override = activeAccount ? accountOverrides[activeAccount.id] : undefined;
  const overrideEnabled = override ? (override.enabled ?? true) : false;
  const effectiveMessage = overrideEnabled && typeof override?.message === "string" ? override.message : message;
  const effectiveMedia = overrideEnabled && Array.isArray(override?.media) ? override.media : media;
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
      thread: thread.map((segment) => ({
        message: segment.message,
        media: toPreviewMedia(segment.media || []),
      })),
      previewDate,
    };
  }, [activeAccount, effectiveMedia, effectiveMessage, options, platform, previewDate, thread]);

  function focusTabByOffset(offset: number) {
    if (!platform || platformAccounts.length < 2) return;
    const index = platformAccounts.findIndex((entry) => entry.platform === platform);
    const next = platformAccounts[(index + offset + platformAccounts.length) % platformAccounts.length];
    setSelectedPlatform(next.platform);
    tabsRef.current?.querySelector<HTMLButtonElement>(`[data-testid="preview-platform-${next.platform}"]`)?.focus();
  }

  function handleTabsKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusTabByOffset(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusTabByOffset(-1);
    }
  }

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
        <div
          ref={tabsRef}
          className="flex flex-wrap items-center justify-center gap-2"
          role="tablist"
          aria-label="Preview platform"
          onKeyDown={handleTabsKeyDown}>
          {platformAccounts.map((entry) => {
            const config = getPlatformById(entry.platform);
            const isActive = entry.platform === platform;
            return (
              <button
                key={entry.platform}
                type="button"
                role="tab"
                id={`preview-tab-${entry.platform}`}
                aria-selected={isActive}
                aria-controls="post-preview-panel"
                aria-label={`Preview ${config?.name || entry.platform}`}
                title={config?.name || entry.platform}
                tabIndex={isActive ? 0 : -1}
                data-testid={`preview-platform-${entry.platform}`}
                onClick={() => setSelectedPlatform(entry.platform)}
                className={cn(
                  "flex size-10 items-center justify-center rounded-full border-2 text-white shadow-sm transition-all hover:-translate-y-0.5",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  config?.color || "bg-neutral-600",
                  isActive
                    ? "border-foreground ring-2 ring-foreground/15"
                    : "border-background opacity-65 hover:opacity-100",
                )}>
                <PlatformIcon platform={entry.platform} className="size-4" />
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="overflow-x-auto pb-1">
        <div
          id="post-preview-panel"
          role="tabpanel"
          aria-labelledby={platform ? `preview-tab-${platform}` : undefined}
          data-testid="post-preview-frame"
          className="mx-auto shrink-0 overflow-hidden rounded-2xl border border-border bg-neutral-950 shadow-sm"
          style={{ width: PREVIEW_FRAME_WIDTH }}>
          <div
            key={platform || "empty"}
            data-testid={`platform-preview-${platform || "empty"}`}
            className="overflow-hidden bg-neutral-950 duration-200 animate-in fade-in">
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
