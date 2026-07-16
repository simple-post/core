"use client";

import { useEffect, useMemo, useState } from "react";

import { ImageIcon, Music2, Play, Plus } from "lucide-react";

import { PlatformIcon } from "@/components/platform-icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

interface PlatformRendererProps {
  account: ConnectedAccount;
  message: string;
  media: MediaFile[];
  options: Record<string, unknown>;
  previewDate: Date;
  thread: ThreadSegment[];
}

const THREAD_PLATFORMS = new Set(["x", "bluesky", "threads", "telegram"]);

function accountName(account: ConnectedAccount) {
  return account.displayName || account.username || getAccountDisplayName(account) || "Your account";
}

function accountHandle(account: ConnectedAccount) {
  const value = account.username || account.displayName || "youraccount";
  return `@${value.replace(/^@/, "").replaceAll(/\s+/g, "").toLowerCase()}`;
}

function optionString(options: Record<string, unknown>, key: string) {
  const value = options[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstLine(value: string, fallback: string) {
  return (
    value
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) || fallback
  );
}

function previewTitle(value: string | undefined, fallback: string) {
  return firstLine(value || "", fallback).replace(/^#+\s*/, "") || fallback;
}

function formatXPostTimestamp(date: Date) {
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  const day = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);

  return `${time} · ${day}`;
}

function formatCompactPostTimestamp(date: Date) {
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);

  return `${time} · ${day}`;
}

function PreviewAvatar({ account, className }: { account: ConnectedAccount; className?: string }) {
  const platform = normalizePreviewPlatform(account.platform);
  const config = getPlatformById(platform);
  const fallback = (accountName(account).match(/[\p{L}\p{N}]/u)?.[0] || platform[0] || "S").toUpperCase();
  const proxyAvatar =
    account.profilePicture && (platform === "x" || platform === "linkedin")
      ? `/api/v1/accounts/${encodeURIComponent(account.id)}/avatar?v=${encodeURIComponent(String(account.updatedAt))}`
      : account.profilePicture;

  return (
    <Avatar className={cn("size-10 shrink-0 border border-white/15", className)}>
      {proxyAvatar ? <AvatarImage src={proxyAvatar} alt="" className="object-cover" /> : null}
      <AvatarFallback
        className={cn("text-xs font-bold text-white ring-1 ring-white/20", config?.color || "bg-neutral-500")}>
        {fallback}
      </AvatarFallback>
    </Avatar>
  );
}

function MediaAsset({
  file,
  className,
  contain = false,
  showPlay = true,
}: {
  file: MediaFile;
  className?: string;
  contain?: boolean;
  showPlay?: boolean;
}) {
  return (
    <div className={cn("relative min-h-0 min-w-0 overflow-hidden bg-neutral-900", className)}>
      {file.type === "image" ? (
        <img
          src={file.thumbnailUrl || file.url}
          alt={file.filename}
          className={cn("size-full", contain ? "object-contain" : "object-cover")}
        />
      ) : (
        <>
          <video
            src={file.url}
            poster={file.thumbnailUrl}
            aria-label={file.filename}
            className={cn("size-full", contain ? "object-contain" : "object-cover")}
            muted
            playsInline
            preload="metadata"
          />
          {showPlay ? (
            <span className="absolute inset-0 flex items-center justify-center bg-black/10">
              <span className="flex size-12 items-center justify-center rounded-full bg-black/55 text-white shadow-lg">
                <Play className="ml-0.5 size-5 fill-current" />
              </span>
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

function MediaMosaic({
  media,
  className,
  rounded = "rounded-2xl",
}: {
  media: MediaFile[];
  className?: string;
  rounded?: string;
}) {
  const shown = media.slice(0, 4);
  if (shown.length === 0) return null;

  if (shown.length === 1) {
    return <MediaAsset file={shown[0]} className={cn("h-full w-full border border-black/10", rounded, className)} />;
  }

  if (shown.length === 2) {
    return (
      <div className={cn("grid h-full grid-cols-2 gap-0.5 overflow-hidden bg-neutral-950", rounded, className)}>
        {shown.map((file) => (
          <MediaAsset key={file.id} file={file} />
        ))}
      </div>
    );
  }

  if (shown.length === 3) {
    return (
      <div className={cn("grid h-full grid-cols-2 gap-0.5 overflow-hidden bg-neutral-950", rounded, className)}>
        <MediaAsset file={shown[0]} className="row-span-2" />
        <MediaAsset file={shown[1]} />
        <MediaAsset file={shown[2]} />
      </div>
    );
  }

  return (
    <div
      className={cn("grid h-full grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden bg-neutral-950", rounded, className)}>
      {shown.map((file, index) => (
        <div key={file.id} className="relative min-h-0 min-w-0">
          <MediaAsset file={file} className="size-full" />
          {index === 3 && media.length > 4 ? (
            <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-semibold text-white">
              +{media.length - 4}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function NaturalMediaAsset({
  file,
  className,
  showPlay = true,
}: {
  file: MediaFile;
  className?: string;
  showPlay?: boolean;
}) {
  return (
    <div className={cn("relative overflow-hidden bg-black", className)}>
      {file.type === "image" ? (
        <img
          src={file.thumbnailUrl || file.url}
          alt={file.filename}
          className="block h-auto max-h-[720px] w-full object-contain"
        />
      ) : (
        <>
          <video
            src={file.url}
            poster={file.thumbnailUrl}
            aria-label={file.filename}
            className="block h-auto max-h-[720px] w-full object-contain"
            muted
            playsInline
            preload="metadata"
          />
          {showPlay ? (
            <span className="absolute inset-0 flex items-center justify-center bg-black/10">
              <span className="flex size-12 items-center justify-center rounded-full bg-black/55 text-white shadow-lg">
                <Play className="ml-0.5 size-5 fill-current" />
              </span>
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

function FeedMedia({
  media,
  mosaicHeight,
  rounded = "rounded-2xl",
  className,
}: {
  media: MediaFile[];
  mosaicHeight: number;
  rounded?: string;
  className?: string;
}) {
  if (media.length === 0) return null;

  if (media.length === 1) {
    return <NaturalMediaAsset file={media[0]} className={cn(rounded, className)} />;
  }

  return (
    <div style={{ height: mosaicHeight }}>
      <MediaMosaic media={media} className={className} rounded={rounded} />
    </div>
  );
}

function EmptyMedia({ label }: { label: string }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-neutral-900 to-neutral-800 text-neutral-400">
      <ImageIcon className="size-9" strokeWidth={1.5} />
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}

function XRenderer({ account, message, media, previewDate, thread }: PlatformRendererProps) {
  const segments = THREAD_PLATFORMS.has("x") ? thread.slice(0, 2) : [];
  return (
    <div className="flex flex-col overflow-hidden bg-black text-[#e7e9ea]">
      <div className="px-8 py-8">
        <div className="flex items-start gap-3">
          <PreviewAvatar account={account} className="size-12 rounded-full" />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-[15px] font-bold leading-5">{accountName(account)}</p>
            <p className="truncate text-[15px] leading-5 text-[#71767b]">{accountHandle(account)}</p>
          </div>
        </div>

        <p className="mt-6 whitespace-pre-wrap break-words text-[17px] leading-[22px]">
          {message || <span className="text-[#71767b]">Your post will appear here.</span>}
        </p>

        {media.length > 0 ? (
          <FeedMedia
            media={media}
            mosaicHeight={204}
            className="mt-5 border border-[#2f3336]"
            rounded="rounded-[18px]"
          />
        ) : null}

        <p className="mt-5 text-[15px] leading-5 text-[#71767b]">{formatXPostTimestamp(previewDate)}</p>
      </div>

      {segments.map((segment, index) => (
        <div key={index} className="relative border-b border-[#2f3336] px-8 py-4">
          <div className="flex gap-3">
            <PreviewAvatar account={account} className="size-10 rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-[14px] leading-5">
                <b>{accountName(account)}</b>
                <span className="text-[#71767b]">{accountHandle(account)} · 1m</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[15px] leading-5">{segment.message}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function InstagramRenderer({ account, message, media }: PlatformRendererProps) {
  const first = media[0];
  return (
    <div className="overflow-hidden bg-black text-neutral-50">
      <div className="flex items-center gap-2 px-3 py-3">
        <PreviewAvatar account={account} className="size-8 rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold">{accountHandle(account).slice(1)}</div>
        </div>
      </div>
      <div className="relative bg-black">
        {first ? (
          <NaturalMediaAsset file={first} className="w-full" />
        ) : (
          <div className="aspect-square">
            <EmptyMedia label="Add a photo or video" />
          </div>
        )}
        {media.length > 1 ? (
          <span className="absolute right-3 top-3 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">
            1/{media.length}
          </span>
        ) : null}
      </div>
      <p className="px-3 pb-4 pt-3 text-xs leading-4">
        <b className="mr-1">{accountHandle(account).slice(1)}</b>
        <span className="whitespace-pre-wrap break-words">
          {message || <span className="font-normal text-neutral-500">Your caption will appear here.</span>}
        </span>
      </p>
    </div>
  );
}

function FacebookRenderer({ account, message, media }: PlatformRendererProps) {
  return (
    <div className="overflow-hidden bg-[#1c1e21] py-3 text-neutral-50">
      <div className="flex items-center gap-2.5 px-3">
        <PreviewAvatar account={account} className="size-10 rounded-full" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{accountName(account)}</p>
          <p className="text-[11px] text-neutral-400">Just now · Public</p>
        </div>
      </div>
      <p className="px-3 pb-3 pt-2 whitespace-pre-wrap break-words text-[14px] leading-[18px]">
        {message || <span className="text-neutral-500">Your post will appear here.</span>}
      </p>
      {media.length > 0 ? <FeedMedia media={media} mosaicHeight={320} rounded="rounded-none" /> : null}
    </div>
  );
}

function TikTokRenderer({ account, message, media, options }: PlatformRendererProps) {
  const first = media[0];
  const caption = optionString(options, "title") ?? message;
  return (
    <div className="relative aspect-[9/16] overflow-hidden bg-black text-white">
      {first ? (
        <MediaAsset file={first} className="absolute inset-0" showPlay={false} />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500 via-neutral-950 to-pink-500" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/70" />
      <div className="absolute left-3 top-3">
        <PreviewAvatar account={account} className="size-10 rounded-full border-2 border-white" />
      </div>
      <div className="absolute bottom-5 left-3 right-3 text-shadow-sm">
        <p className="text-sm font-semibold">{accountHandle(account)}</p>
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-4">
          {caption || "Your caption will appear here."}
        </p>
        <p className="mt-2 flex items-center gap-2 text-xs font-medium">
          <Music2 className="size-3.5" /> original sound - {accountHandle(account).slice(1)}
        </p>
      </div>
    </div>
  );
}

function YouTubeRenderer({ account, message, media, options }: PlatformRendererProps) {
  const title = optionString(options, "title") || firstLine(message, "Your video title");
  const description = optionString(options, "description") || message;
  const first = media[0];
  return (
    <div className="overflow-hidden bg-[#0f0f0f] text-neutral-50">
      {first ? (
        <NaturalMediaAsset file={first} className="w-full" />
      ) : (
        <div className="relative aspect-video w-full bg-black">
          <EmptyMedia label="Add a video" />
        </div>
      )}
      <div className="px-3 pb-4 pt-3">
        <h2 className="line-clamp-2 text-[15px] font-semibold leading-5">{title}</h2>
        <p className="mt-1 text-[11px] text-neutral-400">Just now</p>
        <div className="mt-3 flex items-center gap-2">
          <PreviewAvatar account={account} className="size-9 rounded-full" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{accountName(account)}</p>
            <p className="text-[10px] text-neutral-400">{accountHandle(account)}</p>
          </div>
        </div>
        {description && description !== title ? (
          <p className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-neutral-900 p-3 text-xs leading-4 text-neutral-200">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TelegramRenderer({ account: _account, message, media, thread }: PlatformRendererProps) {
  const messages = [
    { message, media },
    ...thread.slice(0, 2).map((segment) => ({ message: segment.message, media: segment.media || [] })),
  ];
  return (
    <div className="overflow-hidden bg-[#0e1621] text-neutral-100">
      <div
        className="relative space-y-2 overflow-hidden p-3"
        style={{
          backgroundImage: "radial-gradient(rgba(114, 151, 179, 0.16) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}>
        {messages.map((item, index) => (
          <div
            key={index}
            className="relative ml-auto max-w-[310px] overflow-hidden rounded-xl rounded-br-sm bg-[#243447] shadow-sm">
            {item.media.length > 0 ? (
              <div style={{ height: 210 }}>
                <MediaMosaic media={item.media} rounded="rounded-none" />
              </div>
            ) : null}
            <div className="px-2.5 pb-1.5 pt-2">
              <p className="whitespace-pre-wrap break-words text-[13px] leading-[17px]">
                {item.message || <span className="text-neutral-400">Your message will appear here.</span>}
              </p>
              <p className="mt-1 text-right text-[9px] text-neutral-400">9:41</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BlueskyRenderer({ account, message, media, previewDate, thread }: PlatformRendererProps) {
  return (
    <div className="overflow-hidden bg-[#161e27] text-neutral-50">
      {[
        { message, media },
        ...thread.slice(0, 2).map((item) => ({ message: item.message, media: item.media || [] })),
      ].map((item, index) => (
        <div key={index} className={cn("px-4 py-4", index > 0 && "border-t border-[#2e3a46]")}>
          <div className="flex items-center gap-2.5">
            <PreviewAvatar account={account} className="size-10 rounded-full" />
            <div className="min-w-0 flex-1 leading-5">
              <p className="truncate text-[14px] font-bold">{accountName(account)}</p>
              <p className="truncate text-[13px] text-[#aebbc9]">{accountHandle(account)}</p>
            </div>
          </div>
          <p className="mt-3 whitespace-pre-wrap break-words text-[16px] leading-[21px]">
            {item.message || <span className="text-[#aebbc9]">Your post will appear here.</span>}
          </p>
          {item.media.length > 0 ? (
            <div className="mt-3">
              <FeedMedia
                media={item.media}
                mosaicHeight={232}
                className="border border-[#2e3a46]"
                rounded="rounded-lg"
              />
            </div>
          ) : null}
          <p className="mt-3 text-[13px] leading-4 text-[#aebbc9]">{formatCompactPostTimestamp(previewDate)}</p>
        </div>
      ))}
    </div>
  );
}

function ThreadsRenderer({ account, message, media, thread }: PlatformRendererProps) {
  const posts = [
    { message, media },
    ...thread.slice(0, 2).map((item) => ({ message: item.message, media: item.media || [] })),
  ];
  return (
    <div className="overflow-hidden bg-black px-4 py-4 text-neutral-50">
      {posts.map((item, index) => (
        <div key={index} className={cn("relative", index > 0 && "pt-5")}>
          <div className="flex gap-3">
            <div className="relative">
              <PreviewAvatar account={account} className="size-10 rounded-full" />
              {index < posts.length - 1 ? (
                <span
                  className="absolute left-1/2 top-11 w-px -translate-x-1/2 bg-neutral-700"
                  style={{ height: "calc(100% + 1.25rem)" }}
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center text-[13px]">
                <b>{accountHandle(account).slice(1)}</b>
                <span className="ml-auto text-neutral-400">1m</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-[19px]">
                {item.message || <span className="text-neutral-500">Start a thread…</span>}
              </p>
              {item.media.length > 0 ? (
                <div className="mt-2">
                  <FeedMedia media={item.media} mosaicHeight={240} className="border border-neutral-800" />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LinkedInRenderer({ account, message, media }: PlatformRendererProps) {
  return (
    <div className="overflow-hidden bg-[#111827] py-3 text-neutral-50">
      <div className="flex gap-2.5 px-3">
        <PreviewAvatar account={account} className="size-11 rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">
                {accountName(account)} <span className="font-normal text-neutral-400">• 3rd+</span>
              </p>
              <p className="text-[10px] text-neutral-400">1m •</p>
            </div>
            <span className="text-[11px] font-semibold text-[#71b7fb]">Follow</span>
          </div>
        </div>
      </div>
      <p className="px-3 pb-3 pt-2 whitespace-pre-wrap break-words text-[13px] leading-[18px]">
        {message || <span className="text-neutral-500">Your post will appear here.</span>}
      </p>
      {media.length > 0 ? <FeedMedia media={media} mosaicHeight={320} rounded="rounded-none" /> : null}
    </div>
  );
}

function PinterestRenderer({ account, message, media, options }: PlatformRendererProps) {
  const first = media[0];
  const title = optionString(options, "title") || firstLine(message, "Your Pin");
  const description = optionString(options, "description") || message;
  return (
    <div className="overflow-hidden bg-[#111] p-3 text-neutral-50">
      <div className="relative overflow-hidden rounded-3xl bg-neutral-900 shadow-sm">
        {first ? (
          <NaturalMediaAsset file={first} className="w-full" />
        ) : (
          <div className="h-96">
            <EmptyMedia label="Add media for your Pin" />
          </div>
        )}
        {media.length > 1 ? (
          <span className="absolute bottom-3 right-3 rounded-full bg-black/65 px-2 py-1 text-[10px] text-white">
            1/{media.length}
          </span>
        ) : null}
      </div>
      <div className="px-1 pt-3">
        <h2 className="line-clamp-2 text-lg font-semibold leading-5">{title}</h2>
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-4 text-neutral-300">
          {description || "Your description will appear here."}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <PreviewAvatar account={account} className="size-8 rounded-full" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{accountName(account)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ForemRenderer({ account, message, media, options }: PlatformRendererProps) {
  const title = previewTitle(optionString(options, "title") || message, "Your article title");
  const tags = Array.isArray(options.tags)
    ? options.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 4)
    : [];
  return (
    <div className="overflow-hidden bg-[#0f0f0f] text-neutral-50">
      {media[0] ? <MediaAsset file={media[0]} className="h-56 w-full" /> : null}
      <div className="p-4">
        <div className="flex items-center gap-2">
          <PreviewAvatar account={account} className="size-8 rounded-full" />
          <div>
            <p className="text-xs font-medium">{accountName(account)}</p>
            <p className="text-[10px] text-neutral-400">Posted just now</p>
          </div>
        </div>
        <h2 className="mt-4 line-clamp-3 text-[22px] font-bold leading-7">{title}</h2>
        {tags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {tags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </div>
        ) : null}
        <p className="mt-3 line-clamp-5 whitespace-pre-wrap text-sm leading-5 text-neutral-300">
          {message || "Your article body will appear here."}
        </p>
      </div>
    </div>
  );
}

const renderers: Record<string, React.ComponentType<PlatformRendererProps>> = {
  x: XRenderer,
  instagram: InstagramRenderer,
  facebook: FacebookRenderer,
  tiktok: TikTokRenderer,
  youtube: YouTubeRenderer,
  telegram: TelegramRenderer,
  bluesky: BlueskyRenderer,
  threads: ThreadsRenderer,
  linkedin: LinkedInRenderer,
  pinterest: PinterestRenderer,
  forem: ForemRenderer,
};

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
  const PlatformRenderer = renderers[platform];
  const override = activeAccount ? accountOverrides[activeAccount.id] : undefined;
  const overrideEnabled = override ? (override.enabled ?? true) : false;
  const effectiveMessage = overrideEnabled && typeof override?.message === "string" ? override.message : message;
  const effectiveMedia = overrideEnabled && Array.isArray(override?.media) ? override.media : media;
  const options = (activeAccount ? accountOptions[activeAccount.id] : undefined) || {};
  const platformConfig = platform ? getPlatformById(platform) : undefined;
  const [previewDate] = useState(() => new Date());

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
            {activeAccount && PlatformRenderer ? (
              <PlatformRenderer
                account={activeAccount}
                message={effectiveMessage}
                media={effectiveMedia}
                options={options}
                previewDate={previewDate}
                thread={THREAD_PLATFORMS.has(platform) ? thread : []}
              />
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 bg-neutral-950 px-8 text-center">
                <div className="flex size-14 items-center justify-center rounded-full border border-dashed border-neutral-700 bg-neutral-900">
                  <Plus className="size-5 text-neutral-400" />
                </div>
                <p className="text-sm font-semibold text-neutral-100">Select an account</p>
                <p className="text-xs leading-5 text-neutral-400">
                  Your post will be rendered here exactly as it appears on that platform.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
