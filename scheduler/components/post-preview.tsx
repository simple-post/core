"use client";

import { useAccounts } from "@/hooks/use-accounts";
import { getPlatformById } from "@/lib/config";
import type { MediaFile, ConnectedAccount } from "@/types";

import {
  XPreview,
  InstagramPreview,
  FacebookPreview,
  TikTokPreview,
  YouTubePreview,
  TelegramPreview,
} from "./platform-previews";

interface PostPreviewProps {
  message: string;
  media: MediaFile[];
  scheduledDate?: string;
  scheduledTime?: string;
  selectedPlatforms?: string[];
}

type PreviewComponent = React.ComponentType<{ message: string; media: MediaFile[]; platform: string }>;

const platformComponents: Record<string, PreviewComponent> = {
  x: XPreview,
  instagram: InstagramPreview,
  facebook: FacebookPreview,
  tiktok: TikTokPreview,
  youtube: YouTubePreview,
  telegram: TelegramPreview,
};

export function PostPreview({ message, media, selectedPlatforms }: PostPreviewProps) {
  const { data: accounts = [], isLoading: loading } = useAccounts();

  // Get unique platforms from selected accounts
  const selectedAccounts = accounts.filter((acc: ConnectedAccount) => selectedPlatforms?.includes(acc.id));
  const uniquePlatforms: string[] = [...new Set(selectedAccounts.map((acc: ConnectedAccount) => acc.platform))];

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-secondary rounded animate-pulse" />
        <div className="h-64 bg-secondary rounded animate-pulse" />
      </div>
    );
  }

  if (uniquePlatforms.length === 0) {
    return (
      <div className="space-y-3">
        <div className="section-kicker">
          <span className="section-kicker-dot" />
          <span className="section-kicker-label">Preview</span>
        </div>
        <div className="border border-dashed border-border bg-card rounded-2xl p-8 text-center text-muted-foreground text-sm">
          Select accounts to see platform previews.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="section-kicker">
        <span className="section-kicker-dot" />
        <span className="section-kicker-label">Platform previews</span>
      </div>

      {uniquePlatforms.map((platformId: string) => {
        const PlatformComponent = platformComponents[platformId];
        const platformConfig = getPlatformById(platformId);

        if (!PlatformComponent || !platformConfig) return null;

        return (
          <div key={platformId} className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-[1px] ${platformConfig.color}`} />
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {platformConfig.name}
              </span>
            </div>
            <PlatformComponent message={message} media={media} platform={platformId} />
          </div>
        );
      })}
    </div>
  );
}
