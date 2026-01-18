"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import type { MediaFile } from "@/types";
import { useAccounts } from "@/hooks/use-accounts";
import { getPlatformLabel } from "@/lib/utils/platforms";

interface PostPreviewProps {
  message: string;
  media: MediaFile[];
  scheduledDate?: string;
  scheduledTime?: string;
  selectedPlatforms?: string[];
}

export function PostPreview({ message, media, scheduledDate, scheduledTime, selectedPlatforms }: PostPreviewProps) {
  const { accounts, loading } = useAccounts();
  const selectedAccounts = useMemo(
    () => accounts.filter((account) => selectedPlatforms?.includes(account.id)),
    [accounts, selectedPlatforms],
  );
  const platformLabels = useMemo(() => {
    const uniquePlatforms = Array.from(new Set(selectedAccounts.map((account) => account.platform)));
    return uniquePlatforms.map(getPlatformLabel);
  }, [selectedAccounts]);
  const scheduledFor =
    scheduledDate && scheduledTime ? new Date(`${scheduledDate}T${scheduledTime}`) : undefined;
  const primaryMedia = media[0];
  const extraMediaCount = media.length > 1 ? media.length - 1 : 0;

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-6 bg-muted rounded animate-pulse" />
        <div className="h-40 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  if (platformLabels.length === 0) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">Preview</h3>
        <div className="border border-dashed border-border rounded-lg p-6 text-center text-muted-foreground text-sm">
          Select accounts to preview your post
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">Preview</h3>
      <div className="rounded-lg border border-border/60 bg-card p-4 space-y-3">
        <div className="text-xs text-muted-foreground">Posting to {platformLabels.join(", ")}</div>
        <p className="text-sm whitespace-pre-wrap break-words">
          {message || <span className="text-muted-foreground italic">Your message will appear here.</span>}
        </p>
        {primaryMedia && (
          <div className="relative rounded-md overflow-hidden border border-border/50 bg-muted">
            {primaryMedia.type === "image" ? (
              <img src={primaryMedia.url} alt={primaryMedia.filename} className="w-full max-h-56 object-cover" />
            ) : (
              <video src={primaryMedia.url} className="w-full max-h-56 object-cover" muted />
            )}
            {extraMediaCount > 0 && (
              <div className="absolute bottom-2 right-2 rounded-full bg-foreground/80 text-background px-2 py-0.5 text-xs">
                +{extraMediaCount} more
              </div>
            )}
          </div>
        )}
        {scheduledFor && (
          <div className="text-xs text-muted-foreground">
            Scheduled for {format(scheduledFor, "MMM d, yyyy 'at' h:mm a")}
          </div>
        )}
      </div>
    </div>
  );
}
