"use client";

import { useState } from "react";

import Link from "next/link";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";

import { PlatformIconBadge } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import { useAnalyticsPosts, type AnalyticsFilters, type SortableMetric } from "@/hooks/use-analytics";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { cn } from "@/lib/utils";

import { useAnalyticsLabels } from "../labels";

import { PostMetricValue, PostThumb } from "./top-posts";

import type { PostMetric } from "@simple-post/sdk/analytics";

const BASE_COLUMNS: SortableMetric[] = ["views", "likes", "comments", "shares", "engagements", "engagementRate"];

/** Every post in the period with sortable metric columns. Columns follow what the selected platforms report. */
export function PostsTable({
  filters,
  supportedMetrics,
}: {
  filters: AnalyticsFilters;
  supportedMetrics: Set<PostMetric>;
}) {
  const { copy, locale } = useUiCopy();
  const labels = useAnalyticsLabels();
  const [sortBy, setSortBy] = useState<SortableMetric>("publishedAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const filterKey = JSON.stringify(filters);
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }
  const { data, isLoading, isError } = useAnalyticsPosts({ ...filters, sortBy, order, page, limit: 20 });
  const columns = BASE_COLUMNS.filter(
    (column) => column === "engagements" || column === "engagementRate" || supportedMetrics.has(column as PostMetric),
  );

  const toggleSort = (column: SortableMetric) => {
    if (sortBy === column) setOrder(order === "desc" ? "asc" : "desc");
    else {
      setSortBy(column);
      setOrder("desc");
    }
    setPage(1);
  };
  const header = (column: SortableMetric, label: string, align: "start" | "end") => (
    <th
      key={column}
      className={cn("px-2 py-2 font-normal", align === "end" ? "text-end" : "text-start")}
      aria-sort={sortBy === column ? (order === "desc" ? "descending" : "ascending") : "none"}>
      <button
        type="button"
        onClick={() => toggleSort(column)}
        className={cn("inline-flex items-center gap-1 hover:text-foreground", sortBy === column && "text-foreground")}>
        {label}
        {sortBy === column ? (
          order === "desc" ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUp className="h-3 w-3" />
          )
        ) : null}
      </button>
    </th>
  );

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-border font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              <th className="py-2 text-start font-normal">{copy("Post")}</th>
              {header("publishedAt", copy("Published"), "start")}
              {columns.map((column) => header(column, labels.metric[column], "end"))}
            </tr>
          </thead>
          <tbody className={cn(isLoading && "opacity-50")}>
            {(data?.posts ?? []).map((post) => (
              <tr key={post.postId} className="border-b border-border/60 hover:bg-secondary/40">
                <td className="max-w-xs py-2">
                  <Link href={`/posts/${post.postId}`} className="flex items-center gap-3">
                    <PostThumb post={post} />
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm" dir="auto">
                        {post.message || copy("(No text)")}
                      </p>
                      <span className="mt-1 flex -space-x-1">
                        {post.platforms.map((platform) => (
                          <PlatformIconBadge
                            key={platform}
                            platform={platform}
                            className="size-4"
                            iconClassName="text-[8px]"
                          />
                        ))}
                      </span>
                    </div>
                  </Link>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                  <PostMetricValue post={post} metric="publishedAt" locale={locale} />
                </td>
                {columns.map((column) => (
                  <td key={column} className="px-2 py-2 text-end tabular-nums">
                    <PostMetricValue post={post} metric={column} locale={locale} />
                  </td>
                ))}
              </tr>
            ))}
            {!isLoading && (isError || (data?.posts.length ?? 0) === 0) ? (
              <tr>
                <td colSpan={columns.length + 2} className="py-8 text-center text-muted-foreground">
                  {isError
                    ? copy("Analytics could not be loaded. Please try again.")
                    : copy("No published posts in this period.")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {data && data.pagination.totalPages > 1 ? (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <span>
            {copy("Page {{page, number}} of {{total, number}}", {
              page: data.pagination.page,
              total: data.pagination.totalPages,
            })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            aria-label={copy("Previous page")}>
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.pagination.totalPages}
            onClick={() => setPage(page + 1)}
            aria-label={copy("Next page")}>
            <ChevronRight className="h-4 w-4 rtl:rotate-180" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
