"use client";

import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PlatformOptions } from "@/types";

interface PlatformOptionsProps {
  selectedPlatforms: string[];
  options: PlatformOptions;
  onOptionsChange: (options: PlatformOptions) => void;
}

export function PlatformOptionsComponent({ selectedPlatforms, options, onOptionsChange }: PlatformOptionsProps) {
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
        <Label className="text-sm font-medium">Platform-Specific Options</Label>
        <p className="text-xs text-muted-foreground mt-1">Configure additional settings for each platform</p>
      </div>

      {/* X (Twitter) Options */}
      {selectedPlatforms.includes("x") && (
        <Card className="p-4 space-y-4 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-black flex-shrink-0" />
            <h4 className="text-sm font-medium">X (Twitter) Options</h4>
          </div>

          <div>
            <Label htmlFor="x-replyToId" className="text-sm text-muted-foreground">
              Reply To ID (optional)
            </Label>
            <Input
              id="x-replyToId"
              placeholder="Tweet ID to reply to"
              value={options.x?.replyToId || ""}
              onChange={(e) => updateOption("x", "replyToId", e.target.value || undefined)}
              className="mt-1 border-border"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Create a reply or thread by providing a tweet ID to reply to
            </p>
          </div>
        </Card>
      )}

      {/* YouTube Options */}
      {selectedPlatforms.includes("youtube") && (
        <Card className="p-4 space-y-4 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-600 flex-shrink-0" />
            <h4 className="text-sm font-medium">YouTube Options</h4>
          </div>

          <div>
            <Label htmlFor="youtube-privacyStatus" className="text-sm text-muted-foreground">
              Privacy Status
            </Label>
            <Select
              value={options.youtube?.privacyStatus || "private"}
              onValueChange={(value) =>
                updateOption("youtube", "privacyStatus", value as "public" | "private" | "unlisted")
              }>
              <SelectTrigger id="youtube-privacyStatus" className="mt-1 border-border">
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
            <Label htmlFor="youtube-tags" className="text-sm text-muted-foreground">
              Tags (optional)
            </Label>
            <Input
              id="youtube-tags"
              placeholder="education, tutorial, howto (comma separated)"
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
            <p className="text-xs text-muted-foreground mt-1">Separate tags with commas</p>
          </div>

          <div>
            <Label htmlFor="youtube-categoryId" className="text-sm text-muted-foreground">
              Category ID (optional)
            </Label>
            <Select
              value={options.youtube?.categoryId || undefined}
              onValueChange={(value) => updateOption("youtube", "categoryId", value === "none" ? undefined : value)}>
              <SelectTrigger id="youtube-categoryId" className="mt-1 border-border">
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
            <Label htmlFor="youtube-playlistId" className="text-sm text-muted-foreground">
              Playlist ID (optional)
            </Label>
            <Input
              id="youtube-playlistId"
              placeholder="PL1234567890"
              value={options.youtube?.playlistId || ""}
              onChange={(e) => updateOption("youtube", "playlistId", e.target.value)}
              className="mt-1 border-border"
            />
            <p className="text-xs text-muted-foreground mt-1">Add video to a specific playlist</p>
          </div>

          <div>
            <Label htmlFor="youtube-thumbnailUrl" className="text-sm text-muted-foreground">
              Custom Thumbnail URL (optional)
            </Label>
            <Input
              id="youtube-thumbnailUrl"
              placeholder="https://cdn.example.com/thumbnail.jpg"
              value={options.youtube?.thumbnailUrl || ""}
              onChange={(e) => updateOption("youtube", "thumbnailUrl", e.target.value || undefined)}
              className="mt-1 border-border"
            />
            <p className="text-xs text-muted-foreground mt-1">Use a public JPG or PNG URL for the YouTube thumbnail</p>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="youtube-madeForKids"
              checked={options.youtube?.selfDeclaredMadeForKids || false}
              onCheckedChange={(checked) => updateOption("youtube", "selfDeclaredMadeForKids", checked === true)}
            />
            <div>
              <Label htmlFor="youtube-madeForKids" className="text-sm cursor-pointer">
                Made for kids
              </Label>
              <p className="text-xs text-muted-foreground">Declare if this video is made for children</p>
            </div>
          </div>

          <div>
            <Label htmlFor="youtube-publishAt" className="text-sm text-muted-foreground">
              Schedule Publication (optional)
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
            <p className="text-xs text-muted-foreground mt-1">Schedule video for future publication on YouTube</p>
          </div>
        </Card>
      )}

      {/* TikTok Options */}
      {selectedPlatforms.includes("tiktok") && (
        <Card className="p-4 space-y-4 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-black flex-shrink-0" />
            <h4 className="text-sm font-medium">TikTok Options</h4>
          </div>

          <div>
            <Label htmlFor="tiktok-publishMode" className="text-sm text-muted-foreground">
              Publish Mode
            </Label>
            <Select
              value={options.tiktok?.publishMode || "public"}
              onValueChange={(value) => updateOption("tiktok", "publishMode", value as "draft" | "public")}>
              <SelectTrigger id="tiktok-publishMode" className="mt-1 border-border">
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

          {options.tiktok?.publishMode !== "draft" && (
            <>
              <div>
                <Label htmlFor="tiktok-visibility" className="text-sm text-muted-foreground">
                  Visibility
                </Label>
                <Select
                  value={options.tiktok?.visibility || "public"}
                  onValueChange={(value) =>
                    updateOption("tiktok", "visibility", value as "public" | "friends" | "private")
                  }>
                  <SelectTrigger id="tiktok-visibility" className="mt-1 border-border">
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
                    id="tiktok-allowComment"
                    checked={options.tiktok?.allowComment !== false}
                    onCheckedChange={(checked) => updateOption("tiktok", "allowComment", checked === true)}
                  />
                  <Label htmlFor="tiktok-allowComment" className="text-sm cursor-pointer">
                    Allow Comments
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="tiktok-allowDuet"
                    checked={options.tiktok?.allowDuet !== false}
                    onCheckedChange={(checked) => updateOption("tiktok", "allowDuet", checked === true)}
                  />
                  <Label htmlFor="tiktok-allowDuet" className="text-sm cursor-pointer">
                    Allow Duets
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="tiktok-allowStitch"
                    checked={options.tiktok?.allowStitch !== false}
                    onCheckedChange={(checked) => updateOption("tiktok", "allowStitch", checked === true)}
                  />
                  <Label htmlFor="tiktok-allowStitch" className="text-sm cursor-pointer">
                    Allow Stitch
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
            <h4 className="text-sm font-medium">Facebook Options</h4>
          </div>

          <div>
            <Label htmlFor="facebook-publishAt" className="text-sm text-muted-foreground">
              Schedule Publication (optional)
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
            <p className="text-xs text-muted-foreground mt-1">Schedule post for future publication on Facebook</p>
          </div>
        </Card>
      )}

      {/* Instagram - No additional options needed */}
      {selectedPlatforms.includes("instagram") && (
        <Card className="p-4 space-y-2 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex-shrink-0" />
            <h4 className="text-sm font-medium">Instagram Options</h4>
          </div>
          <p className="text-xs text-muted-foreground">
            No additional options required. Media and captions will be posted as configured above.
          </p>
        </Card>
      )}

      {/* Bluesky - No additional options needed */}
      {selectedPlatforms.includes("bluesky") && (
        <Card className="p-4 space-y-2 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-sky-500 flex-shrink-0" />
            <h4 className="text-sm font-medium">Bluesky Options</h4>
          </div>
          <p className="text-xs text-muted-foreground">
            No additional options required. Your text and images will be posted to Bluesky.
          </p>
        </Card>
      )}

      {/* Threads - No additional options needed */}
      {selectedPlatforms.includes("threads") && (
        <Card className="p-4 space-y-2 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-black flex-shrink-0" />
            <h4 className="text-sm font-medium">Threads Options</h4>
          </div>
          <p className="text-xs text-muted-foreground">
            No additional options required. Text and a single media item are supported.
          </p>
        </Card>
      )}

      {/* LinkedIn Options */}
      {selectedPlatforms.includes("linkedin") && (
        <Card className="p-4 space-y-4 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-700 flex-shrink-0" />
            <h4 className="text-sm font-medium">LinkedIn Options</h4>
          </div>

          <div>
            <Label htmlFor="linkedin-visibility" className="text-sm text-muted-foreground">
              Visibility
            </Label>
            <Select
              value={options.linkedin?.visibility || "PUBLIC"}
              onValueChange={(value) => updateOption("linkedin", "visibility", value as "PUBLIC" | "CONNECTIONS")}>
              <SelectTrigger id="linkedin-visibility" className="mt-1 border-border">
                <SelectValue placeholder="Select visibility" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PUBLIC">Public</SelectItem>
                <SelectItem value="CONNECTIONS">Connections Only</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">Choose who can see your LinkedIn post</p>
          </div>
        </Card>
      )}

      {/* DEV/Forem Options */}
      {selectedPlatforms.includes("forem") && (
        <Card className="p-4 space-y-4 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-black flex-shrink-0" />
            <h4 className="text-sm font-medium">DEV/Forem Options</h4>
          </div>

          <div>
            <Label htmlFor="forem-title" className="text-sm text-muted-foreground">
              Article title (optional)
            </Label>
            <Input
              id="forem-title"
              placeholder="My article title"
              value={options.forem?.title || ""}
              onChange={(event) => updateOption("forem", "title", event.target.value || undefined)}
              className="mt-1 border-border"
            />
            <p className="text-xs text-muted-foreground mt-1">Defaults to the first Markdown heading or line</p>
          </div>

          <div>
            <Label htmlFor="forem-tags" className="text-sm text-muted-foreground">
              Tags (optional)
            </Label>
            <Input
              id="forem-tags"
              placeholder="typescript, opensource (comma separated, max 4)"
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
            <p className="text-xs text-muted-foreground mt-1">Forem allows up to four tags per article</p>
          </div>

          <div>
            <Label htmlFor="forem-canonicalUrl" className="text-sm text-muted-foreground">
              Canonical URL (optional)
            </Label>
            <Input
              id="forem-canonicalUrl"
              placeholder="https://myblog.example/original-post"
              value={options.forem?.canonicalUrl || ""}
              onChange={(event) => updateOption("forem", "canonicalUrl", event.target.value || undefined)}
              className="mt-1 border-border"
            />
            <p className="text-xs text-muted-foreground mt-1">Point at the original when cross-posting</p>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="forem-published"
              checked={options.forem?.published !== false}
              onCheckedChange={(checked) => updateOption("forem", "published", checked === true ? undefined : false)}
            />
            <div>
              <Label htmlFor="forem-published" className="text-sm cursor-pointer">
                Publish immediately
              </Label>
              <p className="text-xs text-muted-foreground">Uncheck to save the article as a draft</p>
            </div>
          </div>
        </Card>
      )}

      {/* Nostr Options */}
      {selectedPlatforms.includes("nostr") && (
        <Card className="p-4 space-y-4 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-purple-600 flex-shrink-0" />
            <h4 className="text-sm font-medium">Nostr Options</h4>
          </div>
          <div>
            <Label htmlFor="nostr-subject" className="text-sm text-muted-foreground">
              Subject (optional)
            </Label>
            <Input
              id="nostr-subject"
              placeholder="Topic of the note"
              value={options.nostr?.subject || ""}
              onChange={(event) => updateOption("nostr", "subject", event.target.value || undefined)}
              className="mt-1 border-border"
            />
            <p className="text-xs text-muted-foreground mt-1">Added to the note as a NIP-14 subject tag</p>
          </div>
        </Card>
      )}

      {/* Pinterest Options */}
      {selectedPlatforms.includes("pinterest") && (
        <Card className="p-4 space-y-4 border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-600 flex-shrink-0" />
            <h4 className="text-sm font-medium">Pinterest Options</h4>
          </div>

          <div>
            <Label htmlFor="pinterest-boardId" className="text-sm text-muted-foreground">
              Board ID
            </Label>
            <Input
              id="pinterest-boardId"
              placeholder="1234567890123456789"
              value={options.pinterest?.boardId || ""}
              onChange={(e) => updateOption("pinterest", "boardId", e.target.value)}
              className="mt-1 border-border"
            />
            <p className="text-xs text-muted-foreground mt-1">Required. The board where the pin will be created.</p>
          </div>

          <div>
            <Label htmlFor="pinterest-title" className="text-sm text-muted-foreground">
              Title (optional)
            </Label>
            <Input
              id="pinterest-title"
              placeholder="Pin title"
              value={options.pinterest?.title || ""}
              onChange={(e) => updateOption("pinterest", "title", e.target.value || undefined)}
              className="mt-1 border-border"
            />
          </div>

          <div>
            <Label htmlFor="pinterest-description" className="text-sm text-muted-foreground">
              Description (optional)
            </Label>
            <Textarea
              id="pinterest-description"
              placeholder="Describe your pin"
              value={options.pinterest?.description || ""}
              onChange={(e) => updateOption("pinterest", "description", e.target.value || undefined)}
              className="mt-1 border-border"
            />
          </div>

          <div>
            <Label htmlFor="pinterest-link" className="text-sm text-muted-foreground">
              Destination Link (optional)
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
              Alt Text (optional)
            </Label>
            <Input
              id="pinterest-altText"
              placeholder="Describe the image for accessibility"
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
