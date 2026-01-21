"use client";

import { useEffect, useState } from "react";
import type { MediaFile, ConnectedAccount } from "@/types";
import {
  XPreview,
  InstagramPreview,
  FacebookPreview,
  TikTokPreview,
  YouTubePreview,
  TelegramPreview,
} from "./platform-previews";
import { getPlatformById } from "@/lib/config";

interface PostPreviewProps {
  message: string;
  media: MediaFile[];
  scheduledDate?: string;
  scheduledTime?: string;
  selectedPlatforms?: string[];
}

const platformComponents: Record<string, React.ComponentType<any>> = {
  x: XPreview,
  instagram: InstagramPreview,
  facebook: FacebookPreview,
  tiktok: TikTokPreview,
  youtube: YouTubePreview,
  telegram: TelegramPreview,
};

export function PostPreview({ message, media, scheduledDate, scheduledTime, selectedPlatforms }: PostPreviewProps) {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAccounts() {
      try {
        const response = await fetch("/api/accounts");
        if (response.ok) {
          const data = await response.json();
          setAccounts(data.accounts || []);
        }
      } catch (error) {
        console.error("Failed to load accounts:", error);
      } finally {
        setLoading(false);
      }
    }
    loadAccounts();
  }, []);

  // Get unique platforms from selected accounts
  const selectedAccounts = accounts.filter((acc) => selectedPlatforms?.includes(acc.id));
  const uniquePlatforms = Array.from(new Set(selectedAccounts.map((acc) => acc.platform)));

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted rounded animate-pulse" />
        <div className="h-64 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  if (uniquePlatforms.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">Preview</h3>
        <div className="border border-dashed border-border rounded-lg p-8 text-center text-muted-foreground text-sm">
          Select accounts to see platform previews
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-medium text-muted-foreground">Platform Previews</h3>

      {uniquePlatforms.map((platformId) => {
        const PlatformComponent = platformComponents[platformId];
        const platformConfig = getPlatformById(platformId);

        if (!PlatformComponent || !platformConfig) return null;

        return (
          <div key={platformId} className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <div className={`w-2 h-2 rounded-full ${platformConfig.color}`} />
              <span className="text-xs font-medium text-muted-foreground">{platformConfig.name}</span>
            </div>
            <PlatformComponent message={message} media={media} platform={platformId} />
          </div>
        );
      })}
    </div>
  );
}
