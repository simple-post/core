"use client";

import { useMemo } from "react";

import { QUOTE_CAPABLE_PLATFORMS } from "@simple-post/sdk/platform-names";
import { format } from "date-fns";
import { Info, Quote, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getPlatformById } from "@/lib/config";
import type { SocialPost } from "@/types";

const QUOTE_CAPABLE_PLATFORM_IDS = new Set<string>([...QUOTE_CAPABLE_PLATFORMS, "twitter"]);

function getPlatformDisplayName(platform: string): string {
  const normalized = platform.toLowerCase() === "twitter" ? "x" : platform.toLowerCase();
  return getPlatformById(normalized)?.name ?? platform;
}

function getStatusLabel(status: SocialPost["status"]): string {
  return status === "published" ? "posted" : status;
}

interface QuotePostCardProps {
  sourcePost: SocialPost | null | undefined;
  isLoading: boolean;
  isError?: boolean;
  selectedPlatforms: string[];
  onRemove: () => void;
}

export function QuotePostCard({
  sourcePost,
  isLoading,
  isError = false,
  selectedPlatforms,
  onRemove,
}: QuotePostCardProps) {
  const fallbackPlatformNames = useMemo(() => {
    const names = selectedPlatforms
      .filter((platform) => !QUOTE_CAPABLE_PLATFORM_IDS.has(platform.toLowerCase()))
      .map((platform) => getPlatformDisplayName(platform));
    return [...new Set(names)];
  }, [selectedPlatforms]);

  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <Quote className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">Quoting an existing post</p>
            {sourcePost ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                {getStatusLabel(sourcePost.status)}
              </span>
            ) : null}
          </div>

          {isLoading ? <p className="mt-1 text-sm text-muted-foreground">Loading quoted post…</p> : null}
          {!isLoading && (isError || !sourcePost) ? (
            <p className="mt-1 text-sm text-destructive">
              The quoted post could not be loaded. Remove the quote to publish this as a regular post.
            </p>
          ) : null}
          {!isLoading && sourcePost ? (
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {sourcePost.message || "No message"}
            </p>
          ) : null}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Remove quoted post"
          className="h-7 w-7 shrink-0 p-0"
          onClick={onRemove}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {sourcePost?.status === "scheduled" && sourcePost.scheduledFor ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The source is scheduled for {format(sourcePost.scheduledFor, "MMM d, yyyy 'at' h:mm a")}. This quote must
            publish later; its platform post IDs will be resolved at that time.
          </span>
        </p>
      ) : null}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {fallbackPlatformNames.length > 0 ? (
            <>
              {fallbackPlatformNames.join(", ")} {fallbackPlatformNames.length === 1 ? "doesn’t" : "don’t"} support
              quotes, so{" "}
              {fallbackPlatformNames.length === 1 ? "that destination receives" : "those destinations receive"} a
              regular post.
            </>
          ) : (
            <>Selected platforms use native quotes whenever the source has a matching platform post.</>
          )}
        </span>
      </p>
    </div>
  );
}
