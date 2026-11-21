"use client";

import { Eye, Heart, MessageCircle, Repeat2 } from "lucide-react";

import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import type { PostAnalyticsBadge } from "@/types";

import { formatCompact } from "./format";

/** Compact metrics row for published posts in lists. Renders nothing until analytics were read once. */
export function PostMetricsInline({ analytics }: { analytics?: PostAnalyticsBadge | null }) {
  const { copy, locale } = useUiCopy();
  if (!analytics?.hasData) return null;
  const items = [
    { key: "views", value: analytics.views, Icon: Eye, label: copy("Views") },
    { key: "likes", value: analytics.likes, Icon: Heart, label: copy("Likes") },
    { key: "comments", value: analytics.comments, Icon: MessageCircle, label: copy("Comments") },
    { key: "shares", value: analytics.shares, Icon: Repeat2, label: copy("Shares") },
  ].filter((item) => item.value !== null);
  if (items.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground tabular-nums">
      {items.map(({ key, value, Icon, label }) => (
        <span key={key} className="inline-flex items-center gap-1" title={label}>
          <Icon className="h-3 w-3" aria-hidden />
          <span className="sr-only">{label}</span>
          {formatCompact(value, locale)}
        </span>
      ))}
    </div>
  );
}
