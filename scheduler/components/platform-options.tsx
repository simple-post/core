"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import type { PlatformOptions } from "@/lib/types";

interface PlatformOptionsProps {
  selectedPlatforms: string[];
  options: PlatformOptions;
  onOptionsChange: (options: PlatformOptions) => void;
}

export function PlatformOptionsComponent({ selectedPlatforms, options, onOptionsChange }: PlatformOptionsProps) {
  if (selectedPlatforms.length === 0) {
    return null;
  }

  const updateOption = (platform: keyof PlatformOptions, key: string, value: any) => {
    onOptionsChange({
      ...options,
      [platform]: {
        ...((options[platform] as any) || {}),
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
        <Card className="p-4 space-y-4 border-border/50">
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
              className="mt-1 border-border/50"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Create a reply or thread by providing a tweet ID to reply to
            </p>
          </div>
        </Card>
      )}

      {/* YouTube Options */}
      {selectedPlatforms.includes("youtube") && (
        <Card className="p-4 space-y-4 border-border/50">
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
              <SelectTrigger id="youtube-privacyStatus" className="mt-1 border-border/50">
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
              className="mt-1 border-border/50"
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
              <SelectTrigger id="youtube-categoryId" className="mt-1 border-border/50">
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
              className="mt-1 border-border/50"
            />
            <p className="text-xs text-muted-foreground mt-1">Add video to a specific playlist</p>
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
              className="mt-1 border-border/50"
            />
            <p className="text-xs text-muted-foreground mt-1">Schedule video for future publication on YouTube</p>
          </div>
        </Card>
      )}

      {/* TikTok Options */}
      {selectedPlatforms.includes("tiktok") && (
        <Card className="p-4 space-y-4 border-border/50">
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
              <SelectTrigger id="tiktok-publishMode" className="mt-1 border-border/50">
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
                  <SelectTrigger id="tiktok-visibility" className="mt-1 border-border/50">
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
        <Card className="p-4 space-y-4 border-border/50">
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
              className="mt-1 border-border/50"
            />
            <p className="text-xs text-muted-foreground mt-1">Schedule post for future publication on Facebook</p>
          </div>
        </Card>
      )}

      {/* Instagram - No additional options needed */}
      {selectedPlatforms.includes("instagram") && (
        <Card className="p-4 space-y-2 border-border/50">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex-shrink-0" />
            <h4 className="text-sm font-medium">Instagram Options</h4>
          </div>
          <p className="text-xs text-muted-foreground">
            No additional options required. Media and captions will be posted as configured above.
          </p>
        </Card>
      )}
    </div>
  );
}
