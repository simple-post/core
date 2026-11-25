import type { ComponentProps } from "react";

import { Calendar, CheckCircle, AlertCircle, FileText } from "lucide-react";

import { PostStatusTabs } from "@/components/visual/post-status-tabs";
import { cn } from "@/lib/utils";
export function TabCountBadge({
  count,
  tone = "default",
  className,
}: {
  count: number | undefined;
  tone?: "default" | "danger" | "danger-muted";
  className?: string;
}) {
  const displayCount = typeof count === "number" ? count : 0;

  return (
    <span
      className={cn(
        "ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1.5 text-[10px] leading-none tracking-normal",
        tone === "danger" && "bg-destructive text-destructive-foreground shadow-[0_0_0_3px_rgba(239,68,68,0.18)]",
        tone === "danger-muted" && "bg-destructive/15 text-destructive",
        tone === "default" && "bg-secondary text-muted-foreground",
        className,
      )}>
      {displayCount > 99 ? "99+" : displayCount}
    </span>
  );
}

export function DashboardStatusTabs({
  counts,
  hasUnseenFailed = false,
  extra = [],
}: {
  counts?: { drafts: number; scheduled: number; past: number; failed: number };
  hasUnseenFailed?: boolean;
  extra?: ComponentProps<typeof PostStatusTabs>["items"];
}) {
  const failedCount = counts?.failed ?? 0;
  return (
    <PostStatusTabs
      items={[
        {
          id: "drafts",
          label: "Drafts",
          icon: <FileText className="hidden h-3.5 w-3.5 sm:block" />,
          badge: <TabCountBadge count={counts?.drafts} className="ml-0 sm:ml-1" />,
        },
        {
          id: "scheduled",
          label: "Scheduled",
          icon: <Calendar className="hidden h-3.5 w-3.5 sm:block" />,
          badge: <TabCountBadge count={counts?.scheduled} className="ml-0 sm:ml-1" />,
        },
        {
          id: "past",
          label: "Published",
          icon: <CheckCircle className="hidden h-3.5 w-3.5 sm:block" />,
          badge: <TabCountBadge count={counts?.past} className="ml-0 sm:ml-1" />,
        },
        {
          id: "failed",
          label: "Failed",
          icon: <AlertCircle className="hidden h-3.5 w-3.5 sm:block" />,
          badge: (
            <>
              <TabCountBadge
                count={failedCount}
                tone={hasUnseenFailed ? "danger" : failedCount > 0 ? "danger-muted" : "default"}
                className="ml-0 sm:ml-1"
              />
              {hasUnseenFailed ? (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-destructive shadow-[0_0_0_3px_rgba(239,68,68,0.22)]" />
              ) : null}
            </>
          ),
        },
        ...extra,
      ]}
    />
  );
}
