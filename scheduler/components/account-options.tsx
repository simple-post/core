"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ImageIcon, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAccounts } from "@/hooks/use-accounts";
import { getPlatformById, getAccountDisplayName } from "@/lib/config";
import type { TikTokCreatorInfo, TikTokPrivacyLevel } from "@/lib/tiktok/creator-info";
import type { AccountOptionsMap, ConnectedAccount, MediaFile } from "@/types";

interface AccountOptionsProps {
  selectedAccountIds: string[];
  options: AccountOptionsMap;
  onOptionsChange: (options: AccountOptionsMap) => void;
  media?: MediaFile[];
  onBlockingChange?: (blocked: boolean) => void;
}

interface PinterestBoard {
  id: string;
  name: string;
  description: string | null;
  pinCount: number;
}

const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
const asBoolean = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

const MAX_YOUTUBE_THUMBNAIL_SIZE = 2 * 1024 * 1024;
const YOUTUBE_TITLE_MAX_LENGTH = 100;
const YOUTUBE_DESCRIPTION_MAX_LENGTH = 5000;
const YOUTUBE_THUMBNAIL_TYPES = new Set(["image/jpeg", "image/png"]);

const TIKTOK_PRIVACY_LABELS: Record<TikTokPrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

const TIKTOK_PRIVACY_VALUES = new Set<string>(Object.keys(TIKTOK_PRIVACY_LABELS));

function isTikTokPrivacyLevel(value: string): value is TikTokPrivacyLevel {
  return TIKTOK_PRIVACY_VALUES.has(value);
}

function legacyVisibilityToPrivacyLevel(value: string): TikTokPrivacyLevel | undefined {
  switch (value) {
    case "public": {
      return "PUBLIC_TO_EVERYONE";
    }
    case "friends": {
      return "MUTUAL_FOLLOW_FRIENDS";
    }
    case "private": {
      return "SELF_ONLY";
    }
    default: {
      return undefined;
    }
  }
}

function normalizeImageContentType(file: File) {
  if (file.type === "image/jpg") return "image/jpeg";
  if (file.type) return file.type;

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  return "";
}

async function getPresignedThumbnailUrl(
  filename: string,
  contentType: string,
  size: number,
): Promise<{
  uploadUrl: string;
  publicUrl: string;
}> {
  const response = await fetch("/api/v1/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType, size, isThumbnail: true }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error((data as { error?: string; message?: string }).error || "Failed to get upload URL");
  }

  return response.json();
}

async function uploadToStorage(uploadUrl: string, file: File, contentType: string): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Upload failed (${response.status}): ${text || response.statusText}`);
  }
}

async function uploadThumbnailViaServer(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file, file.name);

  const response = await fetch("/api/v1/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error((data as { error?: string; message?: string }).error || "Failed to upload thumbnail");
  }

  const result = (await response.json()) as { url: string };
  return result.url;
}

async function uploadYouTubeThumbnail(file: File): Promise<string> {
  if (file.size > MAX_YOUTUBE_THUMBNAIL_SIZE) {
    throw new Error("YouTube thumbnails must be 2MB or smaller.");
  }

  const contentType = normalizeImageContentType(file);
  if (!YOUTUBE_THUMBNAIL_TYPES.has(contentType)) {
    throw new Error("YouTube thumbnails must be JPG or PNG images.");
  }

  try {
    const { uploadUrl, publicUrl } = await getPresignedThumbnailUrl(file.name, contentType, file.size);
    await uploadToStorage(uploadUrl, file, contentType);
    return publicUrl;
  } catch {
    return uploadThumbnailViaServer(file);
  }
}

export function AccountOptionsComponent({
  selectedAccountIds,
  options,
  onOptionsChange,
  media = [],
  onBlockingChange,
}: AccountOptionsProps) {
  const { data: accounts = [], isLoading: loading } = useAccounts();
  const thumbnailInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [pinterestBoards, setPinterestBoards] = useState<Record<string, PinterestBoard[]>>({});
  const [boardsLoading, setBoardsLoading] = useState<Record<string, boolean>>({});
  const [boardsError, setBoardsError] = useState<Record<string, string | null>>({});
  const [thumbnailUploads, setThumbnailUploads] = useState<Record<string, boolean>>({});
  const [thumbnailErrors, setThumbnailErrors] = useState<Record<string, string | null>>({});
  const [tiktokCreatorInfo, setTikTokCreatorInfo] = useState<Record<string, TikTokCreatorInfo>>({});
  const [tiktokInfoLoading, setTikTokInfoLoading] = useState<Record<string, boolean>>({});
  const [tiktokInfoErrors, setTikTokInfoErrors] = useState<Record<string, string | null>>({});

  const updateOptions = useCallback(
    (accountId: string, updates: Record<string, unknown>) => {
      const nextAccountOptions = {
        ...((options[accountId] ?? {}) as Record<string, unknown>),
        ...updates,
      };

      for (const [key, value] of Object.entries(nextAccountOptions)) {
        if (value === undefined || value === "") {
          delete nextAccountOptions[key];
        }
      }

      onOptionsChange({
        ...options,
        [accountId]: nextAccountOptions,
      });
    },
    [onOptionsChange, options],
  );

  const updateOption = useCallback(
    (accountId: string, key: string, value: unknown) => {
      updateOptions(accountId, { [key]: value });
    },
    [updateOptions],
  );

  // Fetch Pinterest boards for selected Pinterest accounts
  const fetchBoards = useCallback(async (accountId: string) => {
    setBoardsLoading((prev) => ({ ...prev, [accountId]: true }));
    setBoardsError((prev) => ({ ...prev, [accountId]: null }));

    try {
      const response = await fetch(`/api/v1/accounts/${accountId}/boards`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error((error as { error?: string }).error || "Failed to fetch boards");
      }
      const data = (await response.json()) as { boards: PinterestBoard[] };
      setPinterestBoards((prev) => ({ ...prev, [accountId]: data.boards }));
    } catch (error) {
      setBoardsError((prev) => ({
        ...prev,
        [accountId]: error instanceof Error ? error.message : "Failed to fetch boards",
      }));
    } finally {
      setBoardsLoading((prev) => ({ ...prev, [accountId]: false }));
    }
  }, []);

  useEffect(() => {
    const pinterestAccountIds = accounts
      .filter(
        (acc: ConnectedAccount) =>
          acc.platform.toLowerCase() === "pinterest" && selectedAccountIds.includes(acc.id) && !pinterestBoards[acc.id],
      )
      .map((acc: ConnectedAccount) => acc.id);

    for (const accountId of pinterestAccountIds) {
      fetchBoards(accountId);
    }
  }, [accounts, selectedAccountIds, pinterestBoards, fetchBoards]);

  useEffect(() => {
    const tiktokAccountIds = accounts
      .filter((acc: ConnectedAccount) => acc.platform.toLowerCase() === "tiktok" && selectedAccountIds.includes(acc.id))
      .map((acc: ConnectedAccount) => acc.id);

    setTikTokCreatorInfo((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([accountId]) => tiktokAccountIds.includes(accountId))),
    );
    setTikTokInfoErrors((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([accountId]) => tiktokAccountIds.includes(accountId))),
    );
    setTikTokInfoLoading((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([accountId]) => tiktokAccountIds.includes(accountId))),
    );

    if (tiktokAccountIds.length === 0) {
      return;
    }

    const controllers = new Map<string, AbortController>();

    for (const accountId of tiktokAccountIds) {
      const controller = new AbortController();
      controllers.set(accountId, controller);
      setTikTokInfoLoading((prev) => ({ ...prev, [accountId]: true }));
      setTikTokInfoErrors((prev) => ({ ...prev, [accountId]: null }));

      fetch(`/api/v1/accounts/${accountId}/tiktok/creator-info`, { signal: controller.signal })
        .then(async (response) => {
          const data = (await response.json().catch(() => ({}))) as {
            creatorInfo?: TikTokCreatorInfo;
            error?: string;
          };
          if (!response.ok || !data.creatorInfo) {
            throw new Error(data.error || "Failed to fetch TikTok creator info");
          }
          setTikTokCreatorInfo((prev) => ({ ...prev, [accountId]: data.creatorInfo! }));
        })
        .catch((error) => {
          if (controller.signal.aborted) {
            return;
          }
          setTikTokInfoErrors((prev) => ({
            ...prev,
            [accountId]: error instanceof Error ? error.message : "Failed to fetch TikTok creator info",
          }));
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setTikTokInfoLoading((prev) => ({ ...prev, [accountId]: false }));
          }
        });
    }

    return () => {
      for (const controller of controllers.values()) {
        controller.abort();
      }
    };
  }, [accounts, selectedAccountIds]);

  const selectedAccounts = useMemo(
    () => accounts.filter((acc: { id: string }) => selectedAccountIds.includes(acc.id)),
    [accounts, selectedAccountIds],
  );
  const selectedTikTokAccounts = useMemo(
    () => selectedAccounts.filter((account: ConnectedAccount) => account.platform.toLowerCase() === "tiktok"),
    [selectedAccounts],
  );
  const hasTikTokVideo = media.some((file) => file.type === "video");
  const hasTikTokPhotoOnly = media.length > 0 && media.every((file) => file.type === "image");
  const maxSelectedVideoDurationSec = media
    .filter((file) => file.type === "video" && typeof file.durationSec === "number")
    .reduce<number | null>((max, file) => Math.max(max ?? 0, file.durationSec ?? 0), null);

  const getTikTokPrivacyLevel = useCallback(
    (accountOptions: Record<string, unknown>): TikTokPrivacyLevel | undefined => {
      const privacyLevel = asString(accountOptions.privacyLevel);
      if (isTikTokPrivacyLevel(privacyLevel)) {
        return privacyLevel;
      }
      return legacyVisibilityToPrivacyLevel(asString(accountOptions.visibility));
    },
    [],
  );

  const getTikTokBlockingReasons = (account: ConnectedAccount, accountOptions: Record<string, unknown>) => {
    if ((asString(accountOptions.publishMode) || "public") === "draft") {
      return [];
    }

    const reasons: string[] = [];
    const creatorInfo = tiktokCreatorInfo[account.id];
    const privacyLevel = getTikTokPrivacyLevel(accountOptions);
    const commercialDisclosure = asBoolean(accountOptions.commercialContentDisclosure, false);
    const discloseYourBrand = asBoolean(accountOptions.discloseYourBrand, false);
    const discloseBrandedContent = asBoolean(accountOptions.discloseBrandedContent, false);

    if (tiktokInfoLoading[account.id] || (!creatorInfo && !tiktokInfoErrors[account.id])) {
      reasons.push("Checking latest TikTok creator info.");
    }
    if (tiktokInfoErrors[account.id]) {
      reasons.push(tiktokInfoErrors[account.id]!);
    }
    if (creatorInfo?.canPost === false) {
      reasons.push(creatorInfo.blockReason || "TikTok says this account cannot post right now.");
    }
    if (!privacyLevel) {
      reasons.push("Select a TikTok privacy status.");
    } else if (creatorInfo && !creatorInfo.privacyLevelOptions.includes(privacyLevel)) {
      reasons.push("Select one of the privacy statuses currently available for this TikTok account.");
    }
    if (commercialDisclosure && !discloseYourBrand && !discloseBrandedContent) {
      reasons.push("You need to indicate if your content promotes yourself, a third party, or both.");
    }
    if (discloseBrandedContent && privacyLevel === "SELF_ONLY") {
      reasons.push("Branded content visibility cannot be set to private.");
    }
    if (
      hasTikTokVideo &&
      creatorInfo?.maxVideoPostDurationSec &&
      maxSelectedVideoDurationSec &&
      maxSelectedVideoDurationSec > creatorInfo.maxVideoPostDurationSec
    ) {
      reasons.push(`This video exceeds this creator's ${creatorInfo.maxVideoPostDurationSec}s TikTok limit.`);
    }
    if (creatorInfo?.commentDisabled && asBoolean(accountOptions.allowComment, false)) {
      reasons.push("Comments are disabled by this TikTok account's settings.");
    }
    if (hasTikTokVideo && creatorInfo?.duetDisabled && asBoolean(accountOptions.allowDuet, false)) {
      reasons.push("Duet is disabled by this TikTok account's settings.");
    }
    if (hasTikTokVideo && creatorInfo?.stitchDisabled && asBoolean(accountOptions.allowStitch, false)) {
      reasons.push("Stitch is disabled by this TikTok account's settings.");
    }

    return reasons;
  };

  const tiktokBlocked = selectedAccounts.some((account) => {
    if (account.platform.toLowerCase() !== "tiktok") {
      return false;
    }
    return getTikTokBlockingReasons(account, (options[account.id] ?? {}) as Record<string, unknown>).length > 0;
  });
  const redditBlocked = selectedAccounts.some((account) => {
    if (account.platform.toLowerCase() !== "reddit") return false;
    const accountOptions = (options[account.id] ?? {}) as Record<string, unknown>;
    return !asString(accountOptions.subreddit).trim() || !asString(accountOptions.title).trim();
  });

  useEffect(() => {
    onBlockingChange?.(tiktokBlocked || redditBlocked);
  }, [onBlockingChange, redditBlocked, tiktokBlocked]);

  useEffect(() => {
    for (const account of selectedAccounts) {
      if (account.platform.toLowerCase() !== "tiktok") {
        continue;
      }

      const creatorInfo = tiktokCreatorInfo[account.id];
      if (!creatorInfo) {
        continue;
      }

      const accountOptions = (options[account.id] ?? {}) as Record<string, unknown>;
      const privacyLevel = getTikTokPrivacyLevel(accountOptions);
      const updates: Record<string, unknown> = {};

      if (creatorInfo.commentDisabled && accountOptions.allowComment === true) {
        updates.allowComment = false;
      }
      if ((creatorInfo.duetDisabled || hasTikTokPhotoOnly) && accountOptions.allowDuet === true) {
        updates.allowDuet = false;
      }
      if ((creatorInfo.stitchDisabled || hasTikTokPhotoOnly) && accountOptions.allowStitch === true) {
        updates.allowStitch = false;
      }
      if (accountOptions.discloseBrandedContent === true && privacyLevel === "SELF_ONLY") {
        updates.privacyLevel = undefined;
      }

      if (Object.keys(updates).length > 0) {
        updateOptions(account.id, updates);
      }
    }
  }, [getTikTokPrivacyLevel, hasTikTokPhotoOnly, options, selectedAccounts, tiktokCreatorInfo, updateOptions]);

  if (selectedAccountIds.length === 0) {
    return null;
  }

  if (loading || selectedAccounts.length === 0) {
    return null;
  }

  if (selectedTikTokAccounts.length === 0) {
    return null;
  }

  const handleThumbnailFile = async (accountId: string, file: File | undefined) => {
    if (!file) return;

    setThumbnailUploads((prev) => ({ ...prev, [accountId]: true }));
    setThumbnailErrors((prev) => ({ ...prev, [accountId]: null }));

    try {
      const thumbnailUrl = await uploadYouTubeThumbnail(file);
      updateOption(accountId, "thumbnailUrl", thumbnailUrl);
    } catch (error) {
      setThumbnailErrors((prev) => ({
        ...prev,
        [accountId]: error instanceof Error ? error.message : "Failed to upload thumbnail",
      }));
    } finally {
      setThumbnailUploads((prev) => ({ ...prev, [accountId]: false }));
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="section-kicker">
          <span className="section-kicker-dot" />
          <span className="section-kicker-label">TikTok options</span>
        </div>
        <p className="text-xs text-muted-foreground">Configure required TikTok settings for each selected account.</p>
      </div>

      {selectedTikTokAccounts.map((account: ConnectedAccount) => {
        const platformId = account.platform.toLowerCase();
        const platformConfig = getPlatformById(platformId);
        if (!platformConfig) return null;

        const accountOptions = (options[account.id] ?? {}) as Record<string, unknown>;
        const thumbnailUrl = asString(accountOptions.thumbnailUrl);
        const thumbnailUploading = thumbnailUploads[account.id] === true;
        const thumbnailError = thumbnailErrors[account.id];
        const tiktokInfo = tiktokCreatorInfo[account.id];
        const tiktokPrivacyLevel = getTikTokPrivacyLevel(accountOptions);
        const tiktokBlockingReasons =
          account.platform.toLowerCase() === "tiktok" ? getTikTokBlockingReasons(account, accountOptions) : [];
        const tiktokCommercialDisclosure = asBoolean(accountOptions.commercialContentDisclosure, false);
        const tiktokDiscloseYourBrand = asBoolean(accountOptions.discloseYourBrand, false);
        const tiktokDiscloseBrandedContent = asBoolean(accountOptions.discloseBrandedContent, false);

        return (
          <Card key={account.id} className="p-5 space-y-4">
            <div className="flex items-center gap-2 pb-1">
              <div className={`w-1.5 h-1.5 rounded-[1px] ${platformConfig.color} flex-shrink-0`} />
              <h4 className="text-sm font-medium">
                {getAccountDisplayName(account)}{" "}
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground ml-1">
                  {platformConfig.name}
                </span>
              </h4>
            </div>

            {/* X (Twitter) Options */}
            {account.platform === "x" && (
              <div>
                <Label htmlFor={`${account.id}-replyToId`} className="text-sm text-muted-foreground">
                  Reply To ID (optional)
                </Label>
                <Input
                  id={`${account.id}-replyToId`}
                  placeholder="Tweet ID to reply to"
                  value={asString(accountOptions.replyToId)}
                  onChange={(e) => updateOption(account.id, "replyToId", e.target.value || undefined)}
                  className="mt-1 border-border"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Create a reply or thread by providing a tweet ID to reply to
                </p>
              </div>
            )}

            {/* YouTube Options */}
            {account.platform === "youtube" && (
              <>
                <div>
                  <Label htmlFor={`${account.id}-privacyStatus`} className="text-sm text-muted-foreground">
                    Privacy Status
                  </Label>
                  <Select
                    value={asString(accountOptions.privacyStatus) || "private"}
                    onValueChange={(value) =>
                      updateOption(account.id, "privacyStatus", value as "public" | "private" | "unlisted")
                    }>
                    <SelectTrigger id={`${account.id}-privacyStatus`} className="mt-1 border-border">
                      <SelectValue placeholder="Select privacy status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="private">Private</SelectItem>
                      <SelectItem value="unlisted">Unlisted</SelectItem>
                      <SelectItem value="public">Public</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor={`${account.id}-youtube-title`} className="text-sm text-muted-foreground">
                    Video title
                  </Label>
                  <Input
                    id={`${account.id}-youtube-title`}
                    placeholder="YouTube video title"
                    value={asString(accountOptions.title)}
                    maxLength={YOUTUBE_TITLE_MAX_LENGTH}
                    onChange={(e) => updateOption(account.id, "title", e.target.value || undefined)}
                    className="mt-1 border-border"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {asString(accountOptions.title).length}/{YOUTUBE_TITLE_MAX_LENGTH}. If empty, the message is used.
                  </p>
                </div>

                <div>
                  <Label htmlFor={`${account.id}-youtube-description`} className="text-sm text-muted-foreground">
                    Video description
                  </Label>
                  <Textarea
                    id={`${account.id}-youtube-description`}
                    placeholder="YouTube video description"
                    value={asString(accountOptions.description)}
                    maxLength={YOUTUBE_DESCRIPTION_MAX_LENGTH}
                    onChange={(e) => updateOption(account.id, "description", e.target.value || undefined)}
                    className="mt-1 min-h-24 border-border"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {asString(accountOptions.description).length}/{YOUTUBE_DESCRIPTION_MAX_LENGTH}. If empty, the
                    message is used.
                  </p>
                </div>

                <div>
                  <Label htmlFor={`${account.id}-tags`} className="text-sm text-muted-foreground">
                    Tags (optional)
                  </Label>
                  <Input
                    id={`${account.id}-tags`}
                    placeholder="education, tutorial, howto (comma separated)"
                    value={asStringArray(accountOptions.tags).join(", ")}
                    onChange={(e) =>
                      updateOption(
                        account.id,
                        "tags",
                        e.target.value
                          .split(",")
                          .map((tag) => tag.trim())
                          .filter(Boolean),
                      )
                    }
                    className="mt-1 border-border"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Separate tags with commas</p>
                </div>

                <div>
                  <Label htmlFor={`${account.id}-categoryId`} className="text-sm text-muted-foreground">
                    Category ID (optional)
                  </Label>
                  <Select
                    value={asString(accountOptions.categoryId) || undefined}
                    onValueChange={(value) =>
                      updateOption(account.id, "categoryId", value === "none" ? undefined : value)
                    }>
                    <SelectTrigger id={`${account.id}-categoryId`} className="mt-1 border-border">
                      <SelectValue placeholder="Select category (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="1">Film & Animation</SelectItem>
                      <SelectItem value="2">Autos & Vehicles</SelectItem>
                      <SelectItem value="10">Music</SelectItem>
                      <SelectItem value="15">Pets & Animals</SelectItem>
                      <SelectItem value="17">Sports</SelectItem>
                      <SelectItem value="19">Travel & Events</SelectItem>
                      <SelectItem value="20">Gaming</SelectItem>
                      <SelectItem value="22">People & Blogs</SelectItem>
                      <SelectItem value="23">Comedy</SelectItem>
                      <SelectItem value="24">Entertainment</SelectItem>
                      <SelectItem value="25">News & Politics</SelectItem>
                      <SelectItem value="26">Howto & Style</SelectItem>
                      <SelectItem value="27">Education</SelectItem>
                      <SelectItem value="28">Science & Technology</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor={`${account.id}-playlistId`} className="text-sm text-muted-foreground">
                    Playlist ID (optional)
                  </Label>
                  <Input
                    id={`${account.id}-playlistId`}
                    placeholder="PL1234567890"
                    value={asString(accountOptions.playlistId)}
                    onChange={(e) => updateOption(account.id, "playlistId", e.target.value)}
                    className="mt-1 border-border"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Add video to a specific playlist</p>
                </div>

                <div>
                  <Label htmlFor={`${account.id}-thumbnail`} className="text-sm text-muted-foreground">
                    Custom thumbnail (optional)
                  </Label>
                  <input
                    id={`${account.id}-thumbnail`}
                    ref={(node) => {
                      thumbnailInputRefs.current[account.id] = node;
                    }}
                    type="file"
                    accept="image/jpeg,image/png"
                    className="hidden"
                    onChange={(event) => {
                      void handleThumbnailFile(account.id, event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                  {thumbnailUrl ? (
                    <div className="mt-2 flex items-center gap-3 rounded-lg border border-border bg-secondary/40 p-2">
                      <div className="h-16 w-28 overflow-hidden rounded-md bg-muted">
                        <img src={thumbnailUrl} alt="YouTube custom thumbnail" className="h-full w-full object-cover" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-muted-foreground">{thumbnailUrl}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => updateOption(account.id, "thumbnailUrl", undefined)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 gap-2"
                    disabled={thumbnailUploading}
                    onClick={() => thumbnailInputRefs.current[account.id]?.click()}>
                    {thumbnailUploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ImageIcon className="h-4 w-4" />
                    )}
                    {thumbnailUploading ? "Uploading..." : thumbnailUrl ? "Replace thumbnail" : "Upload thumbnail"}
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1">
                    Upload a JPG or PNG image, up to 2MB. This overrides the generated video preview for YouTube.
                  </p>
                  {thumbnailError ? <p className="text-xs text-destructive mt-1">{thumbnailError}</p> : null}
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={`${account.id}-madeForKids`}
                    checked={asBoolean(accountOptions.selfDeclaredMadeForKids, false)}
                    onCheckedChange={(checked) => updateOption(account.id, "selfDeclaredMadeForKids", checked === true)}
                  />
                  <div>
                    <Label htmlFor={`${account.id}-madeForKids`} className="text-sm cursor-pointer">
                      Made for kids
                    </Label>
                    <p className="text-xs text-muted-foreground">Declare if this video is made for children</p>
                  </div>
                </div>

                <div>
                  <Label htmlFor={`${account.id}-publishAt`} className="text-sm text-muted-foreground">
                    Schedule Publication (optional)
                  </Label>
                  <Input
                    id={`${account.id}-publishAt`}
                    type="datetime-local"
                    value={
                      asString(accountOptions.publishAt)
                        ? new Date(asString(accountOptions.publishAt)).toISOString().slice(0, 16)
                        : ""
                    }
                    onChange={(e) =>
                      updateOption(
                        account.id,
                        "publishAt",
                        e.target.value ? new Date(e.target.value).toISOString() : undefined,
                      )
                    }
                    className="mt-1 border-border"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Schedule video for future publication on YouTube</p>
                </div>
              </>
            )}

            {/* TikTok Options */}
            {platformId === "tiktok" && (
              <>
                <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm">
                  <div className="flex items-center gap-3">
                    {tiktokInfo?.creatorAvatarUrl ? (
                      <img
                        src={tiktokInfo.creatorAvatarUrl}
                        alt=""
                        className="h-9 w-9 rounded-full border border-border object-cover"
                      />
                    ) : (
                      <div className="h-9 w-9 rounded-full border border-border bg-background" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">
                        {tiktokInfo?.creatorNickname || getAccountDisplayName(account)}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {tiktokInfo?.creatorUsername
                          ? `@${tiktokInfo.creatorUsername.replace(/^@/, "")}`
                          : "Checking TikTok account"}
                      </p>
                    </div>
                  </div>
                  {tiktokInfo?.maxVideoPostDurationSec ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Video limit for this creator: {tiktokInfo.maxVideoPostDurationSec}s
                    </p>
                  ) : null}
                </div>

                {tiktokBlockingReasons.length > 0 && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-muted-foreground space-y-1">
                    {tiktokBlockingReasons.map((reason) => (
                      <p key={reason}>{reason}</p>
                    ))}
                  </div>
                )}

                <div>
                  <Label htmlFor={`${account.id}-publishMode`} className="text-sm text-muted-foreground">
                    Publish Mode
                  </Label>
                  <Select
                    value={asString(accountOptions.publishMode) || "public"}
                    onValueChange={(value) => updateOption(account.id, "publishMode", value as "draft" | "public")}>
                    <SelectTrigger id={`${account.id}-publishMode`} className="mt-1 border-border">
                      <SelectValue placeholder="Select publish mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Publish Immediately</SelectItem>
                      <SelectItem value="draft">Save as Draft</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Publish immediately or save to drafts for later review in TikTok app
                  </p>
                </div>

                {(asString(accountOptions.publishMode) || "public") !== "draft" && (
                  <>
                    <div>
                      <Label htmlFor={`${account.id}-tiktok-title`} className="text-sm text-muted-foreground">
                        Title
                      </Label>
                      <Input
                        id={`${account.id}-tiktok-title`}
                        value={asString(accountOptions.title)}
                        onChange={(e) => updateOption(account.id, "title", e.target.value)}
                        placeholder="Enter the TikTok title"
                        maxLength={2200}
                        className="mt-1 border-border"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Preset text and hashtags remain editable before posting.
                      </p>
                    </div>

                    <div>
                      <Label htmlFor={`${account.id}-visibility`} className="text-sm text-muted-foreground">
                        Privacy Status
                      </Label>
                      <Select
                        value={tiktokPrivacyLevel}
                        onValueChange={(value) => {
                          const privacyLevel = value as TikTokPrivacyLevel;
                          updateOptions(account.id, {
                            privacyLevel,
                            visibility: undefined,
                          });
                        }}>
                        <SelectTrigger id={`${account.id}-visibility`} className="mt-1 border-border">
                          <SelectValue placeholder="Select privacy status" />
                        </SelectTrigger>
                        <SelectContent>
                          {(tiktokInfo?.privacyLevelOptions ?? []).map((privacyLevel) => (
                            <SelectItem
                              key={privacyLevel}
                              value={privacyLevel}
                              disabled={tiktokDiscloseBrandedContent && privacyLevel === "SELF_ONLY"}
                              title={
                                tiktokDiscloseBrandedContent && privacyLevel === "SELF_ONLY"
                                  ? "Branded content visibility cannot be set to private."
                                  : undefined
                              }>
                              {TIKTOK_PRIVACY_LABELS[privacyLevel]}
                              {tiktokDiscloseBrandedContent && privacyLevel === "SELF_ONLY"
                                ? " - not available for branded content"
                                : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">
                        Options are loaded from TikTok creator info and must be selected manually.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <p className="text-sm text-muted-foreground mb-2">Interaction Ability</p>
                        <p className="text-xs text-muted-foreground">
                          Turn on each interaction you want to allow. Disabled items are unavailable in TikTok settings.
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id={`${account.id}-allowComment`}
                          checked={tiktokInfo?.commentDisabled ? false : asBoolean(accountOptions.allowComment, false)}
                          disabled={tiktokInfo?.commentDisabled}
                          onCheckedChange={(checked) => updateOption(account.id, "allowComment", checked === true)}
                        />
                        <Label
                          htmlFor={`${account.id}-allowComment`}
                          className={`text-sm ${tiktokInfo?.commentDisabled ? "text-muted-foreground" : "cursor-pointer"}`}>
                          Allow Comments
                        </Label>
                      </div>

                      {!hasTikTokPhotoOnly && (
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`${account.id}-allowDuet`}
                            checked={tiktokInfo?.duetDisabled ? false : asBoolean(accountOptions.allowDuet, false)}
                            disabled={tiktokInfo?.duetDisabled}
                            onCheckedChange={(checked) => updateOption(account.id, "allowDuet", checked === true)}
                          />
                          <Label
                            htmlFor={`${account.id}-allowDuet`}
                            className={`text-sm ${tiktokInfo?.duetDisabled ? "text-muted-foreground" : "cursor-pointer"}`}>
                            Allow Duets
                          </Label>
                        </div>
                      )}

                      {!hasTikTokPhotoOnly && (
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`${account.id}-allowStitch`}
                            checked={tiktokInfo?.stitchDisabled ? false : asBoolean(accountOptions.allowStitch, false)}
                            disabled={tiktokInfo?.stitchDisabled}
                            onCheckedChange={(checked) => updateOption(account.id, "allowStitch", checked === true)}
                          />
                          <Label
                            htmlFor={`${account.id}-allowStitch`}
                            className={`text-sm ${tiktokInfo?.stitchDisabled ? "text-muted-foreground" : "cursor-pointer"}`}>
                            Allow Stitch
                          </Label>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <Label htmlFor={`${account.id}-commercialContentDisclosure`} className="text-sm">
                            Content Disclosure Setting
                          </Label>
                          <p className="text-xs text-muted-foreground mt-1">
                            Indicate whether this content promotes yourself, a brand, product or service.
                          </p>
                        </div>
                        <Switch
                          id={`${account.id}-commercialContentDisclosure`}
                          checked={tiktokCommercialDisclosure}
                          onCheckedChange={(checked) =>
                            updateOptions(account.id, {
                              commercialContentDisclosure: checked,
                              discloseYourBrand: checked ? accountOptions.discloseYourBrand : undefined,
                              discloseBrandedContent: checked ? accountOptions.discloseBrandedContent : undefined,
                            })
                          }
                        />
                      </div>

                      {tiktokCommercialDisclosure && (
                        <div className="space-y-3">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id={`${account.id}-discloseYourBrand`}
                              checked={tiktokDiscloseYourBrand}
                              onCheckedChange={(checked) =>
                                updateOption(account.id, "discloseYourBrand", checked === true)
                              }
                            />
                            <Label htmlFor={`${account.id}-discloseYourBrand`} className="text-sm cursor-pointer">
                              Your brand
                            </Label>
                          </div>
                          {tiktokDiscloseYourBrand && (
                            <p className="text-xs text-muted-foreground">
                              Your photo/video will be labeled as 'Promotional content'
                            </p>
                          )}

                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id={`${account.id}-discloseBrandedContent`}
                              checked={tiktokDiscloseBrandedContent}
                              onCheckedChange={(checked) => {
                                const nextChecked = checked === true;
                                updateOptions(account.id, {
                                  discloseBrandedContent: nextChecked,
                                  privacyLevel:
                                    nextChecked && tiktokPrivacyLevel === "SELF_ONLY" ? undefined : tiktokPrivacyLevel,
                                });
                              }}
                            />
                            <Label htmlFor={`${account.id}-discloseBrandedContent`} className="text-sm cursor-pointer">
                              Branded content
                            </Label>
                          </div>
                          {tiktokDiscloseBrandedContent && (
                            <p className="text-xs text-muted-foreground">
                              Your photo/video will be labeled as 'Paid partnership'
                            </p>
                          )}
                          {!tiktokDiscloseYourBrand && !tiktokDiscloseBrandedContent && (
                            <p
                              className="text-xs text-destructive"
                              title="You need to indicate if your content promotes yourself, a third party, or both.">
                              You need to indicate if your content promotes yourself, a third party, or both.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {/* Facebook Options */}
            {account.platform === "facebook" && (
              <div>
                <Label htmlFor={`${account.id}-publishAt`} className="text-sm text-muted-foreground">
                  Schedule Publication (optional)
                </Label>
                <Input
                  id={`${account.id}-publishAt`}
                  type="datetime-local"
                  value={
                    asString(accountOptions.publishAt)
                      ? new Date(asString(accountOptions.publishAt)).toISOString().slice(0, 16)
                      : ""
                  }
                  onChange={(e) =>
                    updateOption(
                      account.id,
                      "publishAt",
                      e.target.value ? new Date(e.target.value).toISOString() : undefined,
                    )
                  }
                  className="mt-1 border-border"
                />
                <p className="text-xs text-muted-foreground mt-1">Schedule post for future publication on Facebook</p>
              </div>
            )}

            {/* Instagram - No additional options needed */}
            {account.platform === "instagram" && (
              <p className="text-xs text-muted-foreground">
                No additional options required. Media and captions will be posted as configured above.
              </p>
            )}

            {/* Bluesky - No additional options needed */}
            {account.platform === "bluesky" && (
              <p className="text-xs text-muted-foreground">No additional options required for Bluesky posts.</p>
            )}

            {/* Threads - No additional options needed */}
            {account.platform === "threads" && (
              <p className="text-xs text-muted-foreground">No additional options required for Threads posts.</p>
            )}

            {/* LinkedIn Options */}
            {account.platform === "linkedin" && (
              <div>
                <Label htmlFor={`${account.id}-linkedin-visibility`} className="text-sm text-muted-foreground">
                  Visibility
                </Label>
                <Select
                  value={asString(accountOptions.visibility) || "PUBLIC"}
                  onValueChange={(value) => updateOption(account.id, "visibility", value as "PUBLIC" | "CONNECTIONS")}>
                  <SelectTrigger id={`${account.id}-linkedin-visibility`} className="mt-1 border-border">
                    <SelectValue placeholder="Select visibility" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PUBLIC">Public</SelectItem>
                    <SelectItem value="CONNECTIONS">Connections Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Pinterest Options */}
            {account.platform === "pinterest" && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor={`${account.id}-pinterest-boardId`} className="text-sm text-muted-foreground">
                    Board
                  </Label>
                  {boardsLoading[account.id] ? (
                    <div className="mt-1 text-sm text-muted-foreground">Loading boards...</div>
                  ) : boardsError[account.id] ? (
                    <div className="mt-1 space-y-2">
                      <p className="text-sm text-destructive">{boardsError[account.id]}</p>
                      <Input
                        id={`${account.id}-pinterest-boardId`}
                        placeholder="Enter board ID manually"
                        value={asString(accountOptions.boardId)}
                        onChange={(e) => updateOption(account.id, "boardId", e.target.value)}
                        className="border-border"
                      />
                    </div>
                  ) : pinterestBoards[account.id]?.length ? (
                    <Select
                      value={asString(accountOptions.boardId) || undefined}
                      onValueChange={(value) => updateOption(account.id, "boardId", value)}>
                      <SelectTrigger id={`${account.id}-pinterest-boardId`} className="mt-1 border-border">
                        <SelectValue placeholder="Select a board" />
                      </SelectTrigger>
                      <SelectContent>
                        {pinterestBoards[account.id].map((board) => (
                          <SelectItem key={board.id} value={board.id}>
                            {board.name} {board.pinCount > 0 && `(${board.pinCount} pins)`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="mt-1 space-y-2">
                      <p className="text-sm text-muted-foreground">
                        No boards found. Create a board on Pinterest first.
                      </p>
                      <Input
                        id={`${account.id}-pinterest-boardId`}
                        placeholder="Or enter board ID manually"
                        value={asString(accountOptions.boardId)}
                        onChange={(e) => updateOption(account.id, "boardId", e.target.value)}
                        className="border-border"
                      />
                    </div>
                  )}
                </div>
                <div>
                  <Label htmlFor={`${account.id}-pinterest-title`} className="text-sm text-muted-foreground">
                    Title (optional)
                  </Label>
                  <Input
                    id={`${account.id}-pinterest-title`}
                    placeholder="Pin title"
                    value={asString(accountOptions.title)}
                    onChange={(e) => updateOption(account.id, "title", e.target.value || undefined)}
                    className="mt-1 border-border"
                  />
                </div>
                <div>
                  <Label htmlFor={`${account.id}-pinterest-description`} className="text-sm text-muted-foreground">
                    Description (optional)
                  </Label>
                  <Textarea
                    id={`${account.id}-pinterest-description`}
                    placeholder="Describe your pin"
                    value={asString(accountOptions.description)}
                    onChange={(e) => updateOption(account.id, "description", e.target.value || undefined)}
                    className="mt-1 border-border"
                  />
                </div>
                <div>
                  <Label htmlFor={`${account.id}-pinterest-link`} className="text-sm text-muted-foreground">
                    Destination Link (optional)
                  </Label>
                  <Input
                    id={`${account.id}-pinterest-link`}
                    placeholder="https://example.com"
                    value={asString(accountOptions.link)}
                    onChange={(e) => updateOption(account.id, "link", e.target.value || undefined)}
                    className="mt-1 border-border"
                  />
                </div>
                <div>
                  <Label htmlFor={`${account.id}-pinterest-altText`} className="text-sm text-muted-foreground">
                    Alt Text (optional)
                  </Label>
                  <Input
                    id={`${account.id}-pinterest-altText`}
                    placeholder="Describe the image for accessibility"
                    value={asString(accountOptions.altText)}
                    onChange={(e) => updateOption(account.id, "altText", e.target.value || undefined)}
                    className="mt-1 border-border"
                  />
                </div>
              </div>
            )}

            {account.platform === "reddit" && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor={`${account.id}-reddit-subreddit`} className="text-sm text-muted-foreground">
                    Subreddit
                  </Label>
                  <Input
                    id={`${account.id}-reddit-subreddit`}
                    placeholder="r/simplepost"
                    value={asString(accountOptions.subreddit)}
                    onChange={(e) => updateOption(account.id, "subreddit", e.target.value)}
                    className="mt-1 border-border"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor={`${account.id}-reddit-title`} className="text-sm text-muted-foreground">
                    Title
                  </Label>
                  <Input
                    id={`${account.id}-reddit-title`}
                    placeholder="Post title"
                    maxLength={300}
                    value={asString(accountOptions.title)}
                    onChange={(e) => updateOption(account.id, "title", e.target.value)}
                    className="mt-1 border-border"
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">{asString(accountOptions.title).length}/300</p>
                </div>
                <div>
                  <Label htmlFor={`${account.id}-reddit-url`} className="text-sm text-muted-foreground">
                    Link URL (optional)
                  </Label>
                  <Input
                    id={`${account.id}-reddit-url`}
                    type="url"
                    placeholder="https://example.com"
                    value={asString(accountOptions.url)}
                    onChange={(e) => updateOption(account.id, "url", e.target.value || undefined)}
                    className="mt-1 border-border"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor={`${account.id}-reddit-flairId`} className="text-sm text-muted-foreground">
                      Flair ID (optional)
                    </Label>
                    <Input
                      id={`${account.id}-reddit-flairId`}
                      value={asString(accountOptions.flairId)}
                      onChange={(e) => updateOption(account.id, "flairId", e.target.value || undefined)}
                      className="mt-1 border-border"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${account.id}-reddit-flairText`} className="text-sm text-muted-foreground">
                      Flair text (optional)
                    </Label>
                    <Input
                      id={`${account.id}-reddit-flairText`}
                      value={asString(accountOptions.flairText)}
                      onChange={(e) => updateOption(account.id, "flairText", e.target.value || undefined)}
                      className="mt-1 border-border"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-6">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`${account.id}-reddit-nsfw`}
                      checked={asBoolean(accountOptions.nsfw, false)}
                      onCheckedChange={(checked) => updateOption(account.id, "nsfw", checked === true)}
                    />
                    <Label htmlFor={`${account.id}-reddit-nsfw`}>NSFW</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`${account.id}-reddit-spoiler`}
                      checked={asBoolean(accountOptions.spoiler, false)}
                      onCheckedChange={(checked) => updateOption(account.id, "spoiler", checked === true)}
                    />
                    <Label htmlFor={`${account.id}-reddit-spoiler`}>Spoiler</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`${account.id}-reddit-sendReplies`}
                      checked={asBoolean(accountOptions.sendReplies, true)}
                      onCheckedChange={(checked) => updateOption(account.id, "sendReplies", checked === true)}
                    />
                    <Label htmlFor={`${account.id}-reddit-sendReplies`}>Send replies to inbox</Label>
                  </div>
                </div>
              </div>
            )}

            {/* Telegram Options */}
            {account.platform === "telegram" && (
              <div>
                <Label htmlFor={`${account.id}-parseMode`} className="text-sm text-muted-foreground">
                  Parse Mode
                </Label>
                <Select
                  value={asString(accountOptions.parseMode) || "default"}
                  onValueChange={(value) =>
                    updateOption(account.id, "parseMode", value === "default" ? undefined : value)
                  }>
                  <SelectTrigger id={`${account.id}-parseMode`} className="mt-1 border-border">
                    <SelectValue placeholder="Select parse mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    <SelectItem value="HTML">HTML</SelectItem>
                    <SelectItem value="Markdown">Markdown</SelectItem>
                    <SelectItem value="MarkdownV2">MarkdownV2</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Choose how Telegram should parse your message</p>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
