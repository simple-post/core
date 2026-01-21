"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import type { AccountOptionsMap, ConnectedAccount } from "@/types";
import { getPlatformById, getAccountDisplayName } from "@/lib/config";
import { useAccounts } from "@/hooks/use-accounts";

interface AccountOptionsProps {
  selectedAccountIds: string[];
  options: AccountOptionsMap;
  onOptionsChange: (options: AccountOptionsMap) => void;
}

export function AccountOptionsComponent({ selectedAccountIds, options, onOptionsChange }: AccountOptionsProps) {
  const { data: accounts = [], isLoading: loading } = useAccounts();

  if (selectedAccountIds.length === 0) {
    return null;
  }

  const selectedAccounts = accounts.filter((acc: { id: string }) => selectedAccountIds.includes(acc.id));

  if (loading || selectedAccounts.length === 0) {
    return null;
  }

  const updateOption = (accountId: string, key: string, value: any) => {
    onOptionsChange({
      ...options,
      [accountId]: {
        ...((options[accountId] as any) || {}),
        [key]: value,
      },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <Label className="text-sm font-medium">Account-Specific Options</Label>
        <p className="text-xs text-muted-foreground mt-1">Configure additional settings for each account</p>
      </div>

      {selectedAccounts.map((account: ConnectedAccount) => {
        const platformConfig = getPlatformById(account.platform);
        if (!platformConfig) return null;

        const accountOptions = (options[account.id] as any) || {};

        return (
          <Card key={account.id} className="p-4 space-y-4 border-border/50">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${platformConfig.color} flex-shrink-0`} />
              <h4 className="text-sm font-medium">
                {getAccountDisplayName(account)} ({platformConfig.name})
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
                  value={accountOptions.replyToId || ""}
                  onChange={(e) => updateOption(account.id, "replyToId", e.target.value || undefined)}
                  className="mt-1 border-border/50"
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
                    value={accountOptions.privacyStatus || "private"}
                    onValueChange={(value) =>
                      updateOption(account.id, "privacyStatus", value as "public" | "private" | "unlisted")
                    }>
                    <SelectTrigger id={`${account.id}-privacyStatus`} className="mt-1 border-border/50">
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
                    value={accountOptions.tags?.join(", ") || ""}
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
                    className="mt-1 border-border/50"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Separate tags with commas</p>
                </div>

                <div>
                  <Label htmlFor={`${account.id}-categoryId`} className="text-sm text-muted-foreground">
                    Category ID (optional)
                  </Label>
                  <Select
                    value={accountOptions.categoryId || undefined}
                    onValueChange={(value) =>
                      updateOption(account.id, "categoryId", value === "none" ? undefined : value)
                    }>
                    <SelectTrigger id={`${account.id}-categoryId`} className="mt-1 border-border/50">
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
                    value={accountOptions.playlistId || ""}
                    onChange={(e) => updateOption(account.id, "playlistId", e.target.value)}
                    className="mt-1 border-border/50"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Add video to a specific playlist</p>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={`${account.id}-madeForKids`}
                    checked={accountOptions.selfDeclaredMadeForKids || false}
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
                      accountOptions.publishAt ? new Date(accountOptions.publishAt).toISOString().slice(0, 16) : ""
                    }
                    onChange={(e) =>
                      updateOption(
                        account.id,
                        "publishAt",
                        e.target.value ? new Date(e.target.value).toISOString() : undefined,
                      )
                    }
                    className="mt-1 border-border/50"
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
                    value={accountOptions.publishMode || "public"}
                    onValueChange={(value) => updateOption(account.id, "publishMode", value as "draft" | "public")}>
                    <SelectTrigger id={`${account.id}-publishMode`} className="mt-1 border-border/50">
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

                {accountOptions.publishMode !== "draft" && (
                  <>
                    <div>
                      <Label htmlFor={`${account.id}-visibility`} className="text-sm text-muted-foreground">
                        Visibility
                      </Label>
                      <Select
                        value={accountOptions.visibility || "public"}
                        onValueChange={(value) =>
                          updateOption(account.id, "visibility", value as "public" | "friends" | "private")
                        }>
                        <SelectTrigger id={`${account.id}-visibility`} className="mt-1 border-border/50">
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
                          checked={accountOptions.allowComment !== false}
                          onCheckedChange={(checked) => updateOption(account.id, "allowComment", checked === true)}
                        />
                        <Label htmlFor={`${account.id}-allowComment`} className="text-sm cursor-pointer">
                          Allow Comments
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id={`${account.id}-allowDuet`}
                          checked={accountOptions.allowDuet !== false}
                          onCheckedChange={(checked) => updateOption(account.id, "allowDuet", checked === true)}
                        />
                        <Label htmlFor={`${account.id}-allowDuet`} className="text-sm cursor-pointer">
                          Allow Duets
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id={`${account.id}-allowStitch`}
                          checked={accountOptions.allowStitch !== false}
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
                  value={accountOptions.publishAt ? new Date(accountOptions.publishAt).toISOString().slice(0, 16) : ""}
                  onChange={(e) =>
                    updateOption(
                      account.id,
                      "publishAt",
                      e.target.value ? new Date(e.target.value).toISOString() : undefined,
                    )
                  }
                  className="mt-1 border-border/50"
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
          </Card>
        );
      })}
    </div>
  );
}
