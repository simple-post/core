"use client";

import { PlatformIcon } from "@/components/platform-icons";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mergeAccountOptions } from "@/features/platform-options/merge-account-options";
import { getAccountDisplayName } from "@/lib/config";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import type { AccountOptionsMap, AccountOverridesMap, ConnectedAccount, MediaFile } from "@/types";

export function VideoPlacement({
  accounts,
  media,
  overrides,
  options,
  onChange,
  disabled,
}: {
  accounts: ConnectedAccount[];
  media: MediaFile[];
  overrides: AccountOverridesMap;
  options: AccountOptionsMap;
  onChange: (options: AccountOptionsMap) => void;
  disabled?: boolean;
}) {
  const { copy } = useUiCopy();
  const destinations = accounts.filter((account) => {
    if (account.platform !== "instagram" && account.platform !== "facebook") return false;
    const selectedMedia = overrides[account.id]?.media ?? media;
    const placement = options[account.id]?.placement;
    return (
      placement === "story" || placement === "both" || (selectedMedia.length === 1 && selectedMedia[0].type === "video")
    );
  });
  if (destinations.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{copy("Video placement")}</p>
      {destinations.map((account) => {
        const instagram = account.platform === "instagram";
        const controlId = `video-placement-${account.id}`;
        const value = options[account.id]?.placement;
        return (
          <div
            key={account.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <Label htmlFor={controlId} className="flex min-w-0 items-center gap-2">
              <PlatformIcon platform={account.platform} className="size-4 shrink-0" />
              <span className="truncate">{getAccountDisplayName(account)}</span>
            </Label>
            <Select
              disabled={disabled}
              value={value === "both" || value === "story" ? value : "post"}
              onValueChange={(placement) =>
                onChange(
                  mergeAccountOptions(options, account.id, { placement: placement === "post" ? undefined : placement }),
                )
              }>
              <SelectTrigger id={controlId} size="sm" className="w-auto min-w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="post">{instagram ? copy("Reel only") : copy("Page video only")}</SelectItem>
                <SelectItem value="story">{copy("Story only")}</SelectItem>
                <SelectItem value="both">
                  {instagram ? copy("Reel and Story") : copy("Page video and Story")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        );
      })}
      {disabled && (
        <p className="text-xs text-muted-foreground">
          {copy("Retry uses the original placements and skips any that already published.")}
        </p>
      )}
    </div>
  );
}
