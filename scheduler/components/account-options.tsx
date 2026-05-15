"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ImageIcon, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAccounts } from "@/hooks/use-accounts";
import { getPlatformById, getAccountDisplayName } from "@/lib/config";
import type { AccountOptionsMap, ConnectedAccount } from "@/types";

interface AccountOptionsProps {
  selectedAccountIds: string[];
  options: AccountOptionsMap;
  onOptionsChange: (options: AccountOptionsMap) => void;
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
const YOUTUBE_THUMBNAIL_TYPES = new Set(["image/jpeg", "image/png"]);

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
): Promise<{
  uploadUrl: string;
  publicUrl: string;
}> {
  const response = await fetch("/api/v1/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType, isThumbnail: true }),
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
    const { uploadUrl, publicUrl } = await getPresignedThumbnailUrl(file.name, contentType);
    await uploadToStorage(uploadUrl, file, contentType);
    return publicUrl;
  } catch (error) {
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      return uploadThumbnailViaServer(file);
    }
    throw error;
  }
}

export function AccountOptionsComponent({ selectedAccountIds, options, onOptionsChange }: AccountOptionsProps) {
  const { data: accounts = [], isLoading: loading } = useAccounts();
  const thumbnailInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [pinterestBoards, setPinterestBoards] = useState<Record<string, PinterestBoard[]>>({});
  const [boardsLoading, setBoardsLoading] = useState<Record<string, boolean>>({});
  const [boardsError, setBoardsError] = useState<Record<string, string | null>>({});
  const [thumbnailUploads, setThumbnailUploads] = useState<Record<string, boolean>>({});
  const [thumbnailErrors, setThumbnailErrors] = useState<Record<string, string | null>>({});

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

  if (selectedAccountIds.length === 0) {
    return null;
  }

  const selectedAccounts = accounts.filter((acc: { id: string }) => selectedAccountIds.includes(acc.id));

  if (loading || selectedAccounts.length === 0) {
    return null;
  }

  const updateOption = (accountId: string, key: string, value: unknown) => {
    onOptionsChange({
      ...options,
      [accountId]: {
        ...((options[accountId] ?? {}) as Record<string, unknown>),
        [key]: value,
      },
    });
  };

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
          <span className="section-kicker-label">Per-account options</span>
        </div>
        <p className="text-xs text-muted-foreground">Configure additional settings for each connected account.</p>
      </div>

      {selectedAccounts.map((account: ConnectedAccount) => {
        const platformConfig = getPlatformById(account.platform);
        if (!platformConfig) return null;

        const accountOptions = (options[account.id] ?? {}) as Record<string, unknown>;
        const thumbnailUrl = asString(accountOptions.thumbnailUrl);
        const thumbnailUploading = thumbnailUploads[account.id] === true;
        const thumbnailError = thumbnailErrors[account.id];

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
            {account.platform === "tiktok" && (
              <>
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
                      <Label htmlFor={`${account.id}-visibility`} className="text-sm text-muted-foreground">
                        Visibility
                      </Label>
                      <Select
                        value={asString(accountOptions.visibility) || "public"}
                        onValueChange={(value) =>
                          updateOption(account.id, "visibility", value as "public" | "friends" | "private")
                        }>
                        <SelectTrigger id={`${account.id}-visibility`} className="mt-1 border-border">
                          <SelectValue placeholder="Select visibility" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="public">Public</SelectItem>
                          <SelectItem value="friends">Friends Only</SelectItem>
                          <SelectItem value="private">Private</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">Who can view your content</p>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id={`${account.id}-allowComment`}
                          checked={asBoolean(accountOptions.allowComment, true)}
                          onCheckedChange={(checked) => updateOption(account.id, "allowComment", checked === true)}
                        />
                        <Label htmlFor={`${account.id}-allowComment`} className="text-sm cursor-pointer">
                          Allow Comments
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id={`${account.id}-allowDuet`}
                          checked={asBoolean(accountOptions.allowDuet, true)}
                          onCheckedChange={(checked) => updateOption(account.id, "allowDuet", checked === true)}
                        />
                        <Label htmlFor={`${account.id}-allowDuet`} className="text-sm cursor-pointer">
                          Allow Duets
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id={`${account.id}-allowStitch`}
                          checked={asBoolean(accountOptions.allowStitch, true)}
                          onCheckedChange={(checked) => updateOption(account.id, "allowStitch", checked === true)}
                        />
                        <Label htmlFor={`${account.id}-allowStitch`} className="text-sm cursor-pointer">
                          Allow Stitch
                        </Label>
                      </div>
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
