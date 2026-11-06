"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import type { PlatformOptions } from "@/types";

interface PlatformOptionsProps {
  selectedPlatforms: string[];
  options: PlatformOptions;
  onOptionsChange: (options: PlatformOptions) => void;
}

export function PlatformOptionsComponent({ selectedPlatforms, options, onOptionsChange }: PlatformOptionsProps) {
  const { copy } = useUiCopy();
  if (selectedPlatforms.length === 0) {
    return null;
  }

  const updateOption = (platform: keyof PlatformOptions, key: string, value: unknown) => {
    onOptionsChange({
      ...options,
      [platform]: {
        ...((options[platform] ?? {}) as Record<string, unknown>),
        [key]: value,
      },
    } as PlatformOptions);
  };

  return (
    <div className="space-y-6">
      <div>
        <Label className="text-sm font-medium">{copy("Platform-Specific Options")}</Label>
        <p className="text-xs text-muted-foreground mt-1">{copy("Configure additional settings for each platform")}</p>
      </div>

      {/* X (Twitter) Options */}
      {selectedPlatforms.includes("x") && (
        <Card className="p-4 space-y-4 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-black flex-shrink-0" />
            <h4 className="text-sm font-medium">{copy("X (Twitter) Options")}</h4>
          </div>

          <div>
            <Label htmlFor="x-replyToId" className="text-sm text-muted-foreground">
              {copy("Reply To ID (optional)")}{" "}
            </Label>
            <Input
              id="x-replyToId"
              placeholder={copy("Tweet ID to reply to")}
              value={options.x?.replyToId || ""}
              onChange={(e) => updateOption("x", "replyToId", e.target.value || undefined)}
              className="mt-1 border-border"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {copy("Create a reply or thread by providing a tweet ID to reply to")}{" "}
            </p>
          </div>
        </Card>
      )}

      {/* YouTube Options */}
      {selectedPlatforms.includes("youtube") && (
        <Card className="p-4 space-y-4 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-600 flex-shrink-0" />
            <h4 className="text-sm font-medium">{copy("YouTube Options")}</h4>
          </div>

          <div>
            <Label htmlFor="youtube-privacyStatus" className="text-sm text-muted-foreground">
              {copy("Privacy Status")}{" "}
            </Label>
            <Select
              value={options.youtube?.privacyStatus || "private"}
              onValueChange={(value) =>
                updateOption("youtube", "privacyStatus", value as "public" | "private" | "unlisted")
              }>
              <SelectTrigger id="youtube-privacyStatus" className="mt-1 border-border">
                <SelectValue placeholder={copy("Select privacy status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">{copy("Private")}</SelectItem>
                <SelectItem value="unlisted">{copy("Unlisted")}</SelectItem>
                <SelectItem value="public">{copy("Public")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="youtube-tags" className="text-sm text-muted-foreground">
              {copy("Tags (optional)")}{" "}
            </Label>
            <Input
              id="youtube-tags"
              placeholder={copy("education, tutorial, howto (comma separated)")}
              value={options.youtube?.tags?.join(", ") || ""}
              onChange={(e) =>
                updateOption(
                  "youtube",
                  "tags",
                  e.target.value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                )
              }
              className="mt-1 border-border"
            />
            <p className="text-xs text-muted-foreground mt-1">{copy("Separate tags with commas")}</p>
          </div>

          <div>
            <Label htmlFor="youtube-categoryId" className="text-sm text-muted-foreground">
              {copy("Category ID (optional)")}{" "}
            </Label>
            <Select
              value={options.youtube?.categoryId || undefined}
              onValueChange={(value) => updateOption("youtube", "categoryId", value === "none" ? undefined : value)}>
              <SelectTrigger id="youtube-categoryId" className="mt-1 border-border">
                <SelectValue placeholder={copy("Select category (optional)")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{copy("None")}</SelectItem>
                <SelectItem value="1">{copy("Film & Animation")}</SelectItem>
                <SelectItem value="2">{copy("Autos & Vehicles")}</SelectItem>
                <SelectItem value="10">{copy("Music")}</SelectItem>
                <SelectItem value="15">{copy("Pets & Animals")}</SelectItem>
                <SelectItem value="17">{copy("Sports")}</SelectItem>
                <SelectItem value="19">{copy("Travel & Events")}</SelectItem>
                <SelectItem value="20">{copy("Gaming")}</SelectItem>
                <SelectItem value="22">{copy("People & Blogs")}</SelectItem>
                <SelectItem value="23">{copy("Comedy")}</SelectItem>
                <SelectItem value="24">{copy("Entertainment")}</SelectItem>
                <SelectItem value="25">{copy("News & Politics")}</SelectItem>
                <SelectItem value="26">{copy("Howto & Style")}</SelectItem>
                <SelectItem value="27">{copy("Education")}</SelectItem>
                <SelectItem value="28">{copy("Science & Technology")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="text-sm text-muted-foreground">
            <p>
              {copy(
                "Playlist assignment is temporarily unavailable. Add your video to a playlist in YouTube Studio after publishing.",
              )}{" "}
            </p>
            {options.youtube?.playlistId && (
              <div className="mt-2 space-y-2">
                <p role="alert">{copy("Remove the saved playlist option before publishing this post.")}</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => updateOption("youtube", "playlistId", undefined)}>
                  {copy("Remove playlist")}{" "}
                </Button>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="youtube-thumbnailUrl" className="text-sm text-muted-foreground">
              {copy("Custom Thumbnail URL (optional)")}{" "}
            </Label>
            <Input
              id="youtube-thumbnailUrl"
              placeholder="https://cdn.example.com/thumbnail.jpg"
              value={options.youtube?.thumbnailUrl || ""}
              onChange={(e) => updateOption("youtube", "thumbnailUrl", e.target.value || undefined)}
              className="mt-1 border-border"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {copy("Use a public JPG or PNG URL for the YouTube thumbnail")}
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="youtube-madeForKids"
              checked={options.youtube?.selfDeclaredMadeForKids || false}
              onCheckedChange={(checked) => updateOption("youtube", "selfDeclaredMadeForKids", checked === true)}
            />
            <div>
              <Label htmlFor="youtube-madeForKids" className="text-sm cursor-pointer">
                {copy("Made for kids")}{" "}
              </Label>
              <p className="text-xs text-muted-foreground">{copy("Declare if this video is made for children")}</p>
            </div>
          </div>

          <div>
            <Label htmlFor="youtube-publishAt" className="text-sm text-muted-foreground">
              {copy("Schedule Publication (optional)")}{" "}
            </Label>
            <Input
              id="youtube-publishAt"
              type="datetime-local"
              value={options.youtube?.publishAt ? new Date(options.youtube.publishAt).toISOString().slice(0, 16) : ""}
              onChange={(e) =>
                updateOption(
                  "youtube",
                  "publishAt",
                  e.target.value ? new Date(e.target.value).toISOString() : undefined,
                )
              }
              className="mt-1 border-border"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {copy("Schedule video for future publication on YouTube")}
            </p>
          </div>
        </Card>
      )}

      {/* TikTok Options */}
      {selectedPlatforms.includes("tiktok") && (
        <Card className="p-4 space-y-4 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-black flex-shrink-0" />
            <h4 className="text-sm font-medium">{copy("TikTok Options")}</h4>
          </div>

          <div>
            <Label htmlFor="tiktok-publishMode" className="text-sm text-muted-foreground">
              {copy("Publish Mode")}{" "}
            </Label>
            <Select
              value={options.tiktok?.publishMode || "public"}
              onValueChange={(value) =>
                onOptionsChange({
                  ...options,
                  tiktok: {
                    ...options.tiktok,
                    publishMode: value as "draft" | "public",
                    ...(value === "draft" ? { autoAddMusic: false } : {}),
                  },
                })
              }>
              <SelectTrigger id="tiktok-publishMode" className="mt-1 border-border">
                <SelectValue placeholder={copy("Select publish mode")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">{copy("Publish Immediately")}</SelectItem>
                <SelectItem value="draft">{copy("Upload to TikTok inbox")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {copy("Upload to TikTok inbox to add music, edit, and publish manually in TikTok.")}{" "}
            </p>
          </div>

          {options.tiktok?.publishMode !== "draft" && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="tiktok-autoAddMusic"
                checked={options.tiktok?.autoAddMusic === true}
                onCheckedChange={(checked) => updateOption("tiktok", "autoAddMusic", checked === true)}
              />
              <Label htmlFor="tiktok-autoAddMusic">{copy("Automatically add music (photo posts only)")}</Label>
            </div>
          )}
          {options.tiktok?.publishMode !== "draft" && (
            <>
              <div>
                <Label htmlFor="tiktok-visibility" className="text-sm text-muted-foreground">
                  {copy("Visibility")}{" "}
                </Label>
                <Select
                  value={options.tiktok?.visibility || "public"}
                  onValueChange={(value) =>
                    updateOption("tiktok", "visibility", value as "public" | "friends" | "private")
                  }>
                  <SelectTrigger id="tiktok-visibility" className="mt-1 border-border">
                    <SelectValue placeholder={copy("Select visibility")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">{copy("Public")}</SelectItem>
                    <SelectItem value="friends">{copy("Friends Only")}</SelectItem>
                    <SelectItem value="private">{copy("Private")}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">{copy("Who can view your content")}</p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="tiktok-allowComment"
                    checked={options.tiktok?.allowComment !== false}
                    onCheckedChange={(checked) => updateOption("tiktok", "allowComment", checked === true)}
                  />
                  <Label htmlFor="tiktok-allowComment" className="text-sm cursor-pointer">
                    {copy("Allow Comments")}{" "}
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="tiktok-allowDuet"
                    checked={options.tiktok?.allowDuet !== false}
                    onCheckedChange={(checked) => updateOption("tiktok", "allowDuet", checked === true)}
                  />
                  <Label htmlFor="tiktok-allowDuet" className="text-sm cursor-pointer">
                    {copy("Allow Duets")}{" "}
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="tiktok-allowStitch"
                    checked={options.tiktok?.allowStitch !== false}
                    onCheckedChange={(checked) => updateOption("tiktok", "allowStitch", checked === true)}
                  />
                  <Label htmlFor="tiktok-allowStitch" className="text-sm cursor-pointer">
                    {copy("Allow Stitch")}{" "}
                  </Label>
                </div>
              </div>
            </>
          )}
        </Card>
      )}

      {/* Facebook Options */}
      {selectedPlatforms.includes("facebook") && (
        <Card className="p-4 space-y-4 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-600 flex-shrink-0" />
            <h4 className="text-sm font-medium">{copy("Facebook Options")}</h4>
          </div>

          <div>
            <Label htmlFor="facebook-publishAt" className="text-sm text-muted-foreground">
              {copy("Schedule Publication (optional)")}{" "}
            </Label>
            <Input
              id="facebook-publishAt"
              type="datetime-local"
              value={options.facebook?.publishAt ? new Date(options.facebook.publishAt).toISOString().slice(0, 16) : ""}
              onChange={(e) =>
                updateOption(
                  "facebook",
                  "publishAt",
                  e.target.value ? new Date(e.target.value).toISOString() : undefined,
                )
              }
              className="mt-1 border-border"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {copy("Schedule post for future publication on Facebook")}
            </p>
          </div>
        </Card>
      )}

      {/* Instagram - No additional options needed */}
      {selectedPlatforms.includes("instagram") && (
        <Card className="p-4 space-y-2 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex-shrink-0" />
            <h4 className="text-sm font-medium">{copy("Instagram Options")}</h4>
          </div>
          <p className="text-xs text-muted-foreground">
            {copy("No additional options required. Media and captions will be posted as configured above.")}{" "}
          </p>
        </Card>
      )}

      {/* Bluesky - No additional options needed */}
      {selectedPlatforms.includes("bluesky") && (
        <Card className="p-4 space-y-2 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-sky-500 flex-shrink-0" />
            <h4 className="text-sm font-medium">{copy("Bluesky Options")}</h4>
          </div>
          <p className="text-xs text-muted-foreground">
            {copy(
              "No additional options required. Post text, up to 4 images, or one MP4 video (300 MB, 10 minutes).",
            )}{" "}
          </p>
        </Card>
      )}

      {/* Threads - No additional options needed */}
      {selectedPlatforms.includes("threads") && (
        <Card className="p-4 space-y-2 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-black flex-shrink-0" />
            <h4 className="text-sm font-medium">{copy("Threads Options")}</h4>
          </div>
          <p className="text-xs text-muted-foreground">
            {copy("No additional options required. Text and a single media item are supported.")}{" "}
          </p>
        </Card>
      )}

      {/* LinkedIn Options */}
      {selectedPlatforms.includes("linkedin") && (
        <Card className="p-4 space-y-4 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-700 flex-shrink-0" />
            <h4 className="text-sm font-medium">{copy("LinkedIn Options")}</h4>
          </div>

          <div>
            <Label htmlFor="linkedin-visibility" className="text-sm text-muted-foreground">
              {copy("Visibility")}{" "}
            </Label>
            <Select
              value={options.linkedin?.visibility || "PUBLIC"}
              onValueChange={(value) => updateOption("linkedin", "visibility", value as "PUBLIC" | "CONNECTIONS")}>
              <SelectTrigger id="linkedin-visibility" className="mt-1 border-border">
                <SelectValue placeholder={copy("Select visibility")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PUBLIC">{copy("Public")}</SelectItem>
                <SelectItem value="CONNECTIONS">{copy("Connections Only")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">{copy("Choose who can see your LinkedIn post")}</p>
          </div>
        </Card>
      )}

      {/* DEV/Forem Options */}
      {selectedPlatforms.includes("forem") && (
        <Card className="p-4 space-y-4 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-black flex-shrink-0" />
            <h4 className="text-sm font-medium">{copy("DEV/Forem Options")}</h4>
          </div>

          <div>
            <Label htmlFor="forem-title" className="text-sm text-muted-foreground">
              {copy("Article title (optional)")}{" "}
            </Label>
            <Input
              id="forem-title"
              placeholder={copy("My article title")}
              value={options.forem?.title || ""}
              onChange={(event) => updateOption("forem", "title", event.target.value || undefined)}
              className="mt-1 border-border"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {copy("Defaults to the first Markdown heading or line")}
            </p>
          </div>

          <div>
            <Label htmlFor="forem-tags" className="text-sm text-muted-foreground">
              {copy("Tags (optional)")}{" "}
            </Label>
            <Input
              id="forem-tags"
              placeholder={copy("typescript, opensource (comma separated, max 4)")}
              value={options.forem?.tags?.join(", ") || ""}
              onChange={(event) => {
                const tags = event.target.value
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean);
                updateOption("forem", "tags", tags.length > 0 ? tags : undefined);
              }}
              className="mt-1 border-border"
            />
            <p className="text-xs text-muted-foreground mt-1">{copy("Forem allows up to four tags per article")}</p>
          </div>

          <div>
            <Label htmlFor="forem-canonicalUrl" className="text-sm text-muted-foreground">
              {copy("Canonical URL (optional)")}{" "}
            </Label>
            <Input
              id="forem-canonicalUrl"
              placeholder="https://myblog.example/original-post"
              value={options.forem?.canonicalUrl || ""}
              onChange={(event) => updateOption("forem", "canonicalUrl", event.target.value || undefined)}
              className="mt-1 border-border"
            />
            <p className="text-xs text-muted-foreground mt-1">{copy("Point at the original when cross-posting")}</p>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="forem-published"
              checked={options.forem?.published !== false}
              onCheckedChange={(checked) => updateOption("forem", "published", checked === true ? undefined : false)}
            />
            <div>
              <Label htmlFor="forem-published" className="text-sm cursor-pointer">
                {copy("Publish immediately")}{" "}
              </Label>
              <p className="text-xs text-muted-foreground">{copy("Uncheck to save the article as a draft")}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Pinterest Options */}
      {selectedPlatforms.includes("pinterest") && (
        <Card className="p-4 space-y-4 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-600 flex-shrink-0" />
            <h4 className="text-sm font-medium">{copy("Pinterest Options")}</h4>
          </div>

          <div>
            <Label htmlFor="pinterest-boardId" className="text-sm text-muted-foreground">
              {copy("Board ID")}{" "}
            </Label>
            <Input
              id="pinterest-boardId"
              placeholder="1234567890123456789"
              value={options.pinterest?.boardId || ""}
              onChange={(e) => updateOption("pinterest", "boardId", e.target.value)}
              className="mt-1 border-border"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {copy("Required. The board where the pin will be created.")}
            </p>
          </div>

          <div>
            <Label htmlFor="pinterest-title" className="text-sm text-muted-foreground">
              {copy("Title (optional)")}{" "}
            </Label>
            <Input
              id="pinterest-title"
              placeholder={copy("Pin title")}
              value={options.pinterest?.title || ""}
              onChange={(e) => updateOption("pinterest", "title", e.target.value || undefined)}
              className="mt-1 border-border"
            />
          </div>

          <div>
            <Label htmlFor="pinterest-description" className="text-sm text-muted-foreground">
              {copy("Description (optional)")}{" "}
            </Label>
            <Textarea
              id="pinterest-description"
              placeholder={copy("Describe your pin")}
              value={options.pinterest?.description || ""}
              onChange={(e) => updateOption("pinterest", "description", e.target.value || undefined)}
              className="mt-1 border-border"
            />
          </div>

          <div>
            <Label htmlFor="pinterest-link" className="text-sm text-muted-foreground">
              {copy("Destination Link (optional)")}{" "}
            </Label>
            <Input
              id="pinterest-link"
              placeholder="https://example.com"
              value={options.pinterest?.link || ""}
              onChange={(e) => updateOption("pinterest", "link", e.target.value || undefined)}
              className="mt-1 border-border"
            />
          </div>

          <div>
            <Label htmlFor="pinterest-altText" className="text-sm text-muted-foreground">
              {copy("Alt Text (optional)")}{" "}
            </Label>
            <Input
              id="pinterest-altText"
              placeholder={copy("Describe the image for accessibility")}
              value={options.pinterest?.altText || ""}
              onChange={(e) => updateOption("pinterest", "altText", e.target.value || undefined)}
              className="mt-1 border-border"
            />
          </div>
        </Card>
      )}
    </div>
  );
}
