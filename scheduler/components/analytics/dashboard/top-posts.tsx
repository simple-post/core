"use client";

import Link from "next/link";

import { ImageIcon, Play } from "lucide-react";

import { PlatformIconBadge } from "@/components/platform-icons";
import type { PostSummaryItem, SortableMetric } from "@/hooks/use-analytics";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

import { formatMetricValue, formatPercent } from "../format";
import { useAnalyticsLabels } from "../labels";

export const TOP_POST_SORTS: SortableMetric[] = [
  "engagements",
  "views",
  "likes",
  "comments",
  "shares",
  "engagementRate",
];

export function PostMetricValue({
  post,
  metric,
  locale,
}: {
  post: PostSummaryItem;
  metric: SortableMetric;
  locale: string;
}) {
  if (metric === "engagementRate") return <>{formatPercent(post.engagementRate, locale, 2)}</>;
  if (metric === "engagements") return <>{formatMetricValue("engagements", post.engagements, locale)}</>;
  if (metric === "publishedAt")
    return <>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(post.publishedAt))}</>;
  return <>{formatMetricValue(metric, post.metrics[metric], locale)}</>;
}

export function PostThumb({ post }: { post: PostSummaryItem }) {
  return (
    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-secondary">
      {post.thumbnailUrl ? (
        <img src={post.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          {post.mediaType === "video" ? <Play className="h-4 w-4" /> : <ImageIcon className="h-4 w-4 opacity-40" />}
        </div>
      )}
      {post.mediaType === "video" && post.thumbnailUrl ? (
        <Play className="absolute bottom-1 end-1 h-3 w-3 fill-white text-white drop-shadow" />
      ) : null}
    </div>
  );
}

export function TopPosts({
  posts,
  sortBy,
  onSortChange,
}: {
  posts: PostSummaryItem[];
  sortBy: SortableMetric;
  onSortChange: (sort: SortableMetric) => void;
}) {
  const { copy, locale } = useUiCopy();
  const labels = useAnalyticsLabels();
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label={copy("Rank by")}>
        {TOP_POST_SORTS.map((sort) => (
          <button
            key={sort}
            type="button"
            aria-pressed={sortBy === sort}
            onClick={() => onSortChange(sort)}
            className={
              sortBy === sort
                ? "rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground"
                : "rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            }>
            {labels.metric[sort]}
          </button>
        ))}
      </div>
      {posts.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {copy("No posts with analytics in this period yet.")}
        </p>
      ) : (
        <ol className="space-y-1">
          {posts.map((post, index) => (
            <li key={post.postId}>
              <Link
                href={`/posts/${post.postId}`}
                className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-secondary/50">
                <span className="w-5 text-center font-mono text-xs text-muted-foreground">{index + 1}</span>
                <PostThumb post={post} />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-sm" dir="auto">
                    {post.message || copy("(No text)")}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex -space-x-1">
                      {post.platforms.map((platform) => (
                        <PlatformIconBadge
                          key={platform}
                          platform={platform}
                          className="size-4"
                          iconClassName="text-[8px]"
                        />
                      ))}
                    </span>
                    <span>
                      {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(post.publishedAt))}
                    </span>
                  </div>
                </div>
                <div className="text-end">
                  <div className="font-semibold tabular-nums">
                    <PostMetricValue post={post} metric={sortBy} locale={locale} />
                  </div>
                  <div className="text-xs text-muted-foreground">{labels.metric[sortBy]}</div>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
