"use client";

import { useState, useEffect } from "react";

import { useSearchParams, useRouter } from "next/navigation";

import { Calendar, CalendarDays, CheckCircle, AlertCircle, FileText } from "lucide-react";

import { Navbar } from "@/components/navbar";
import { PostsList } from "@/components/posts-list";
import { ScheduleCalendar } from "@/components/schedule-calendar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePostCounts } from "@/hooks/use-posts";
import { useSession } from "@/lib/auth/auth-client";
import { cn } from "@/lib/utils";

type TimelineTabType = "scheduled" | "past" | "failed";
type DashboardTabParam = TimelineTabType | "published" | "posted" | "drafts" | "calendar";

const TIMELINE_TABS = new Set<TimelineTabType>(["scheduled", "past", "failed"]);
const DASHBOARD_TAB_PARAMS = new Set<DashboardTabParam>([
  "scheduled",
  "past",
  "failed",
  "published",
  "posted",
  "drafts",
  "calendar",
]);
const FAILED_SEEN_STORAGE_KEY_PREFIX = "simplepost:dashboard:last-seen-failed-at:v1";

function getTimelineTabFromParam(value: string | null): TimelineTabType | null {
  if (!value) return null;
  if (value === "published" || value === "posted") return "past";
  return TIMELINE_TABS.has(value as TimelineTabType) ? (value as TimelineTabType) : null;
}

function isKnownDashboardTabParam(value: string | null): value is DashboardTabParam {
  return Boolean(value && DASHBOARD_TAB_PARAMS.has(value as DashboardTabParam));
}

function TabCountBadge({
  count,
  tone = "default",
}: {
  count: number | undefined;
  tone?: "default" | "danger" | "danger-muted";
}) {
  const displayCount = typeof count === "number" ? count : 0;

  return (
    <span
      className={cn(
        "ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1.5 text-[10px] leading-none tracking-normal",
        tone === "danger" && "bg-destructive text-destructive-foreground shadow-[0_0_0_3px_rgba(239,68,68,0.18)]",
        tone === "danger-muted" && "bg-destructive/15 text-destructive",
        tone === "default" && "bg-secondary text-muted-foreground",
      )}>
      {displayCount > 99 ? "99+" : displayCount}
    </span>
  );
}

export default function Dashboard() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get("tab");
  const { data: session } = useSession();
  const { data: postCounts } = usePostCounts();

  const [activeTab, setActiveTab] = useState<TimelineTabType>(getTimelineTabFromParam(tabParam) ?? "scheduled");
  const [lastSeenFailedAt, setLastSeenFailedAt] = useState<string | null>(null);
  const [draftsPage, setDraftsPage] = useState(1);
  const [scheduledPage, setScheduledPage] = useState(1);
  const [postedPage, setPostedPage] = useState(1);
  const [failedPage, setFailedPage] = useState(1);
  const [draftsPageSize, setDraftsPageSize] = useState(25);
  const [scheduledPageSize, setScheduledPageSize] = useState(25);
  const [postedPageSize, setPostedPageSize] = useState(25);
  const [failedPageSize, setFailedPageSize] = useState(25);
  const failedSeenStorageKey = session?.user?.id ? `${FAILED_SEEN_STORAGE_KEY_PREFIX}:${session.user.id}` : null;
  const latestFailedAt = postCounts?.latestFailedAt ?? null;
  const failedCount = postCounts?.counts.failed ?? 0;
  const hasUnseenFailed =
    activeTab !== "failed" &&
    failedCount > 0 &&
    Boolean(latestFailedAt && (!lastSeenFailedAt || latestFailedAt > lastSeenFailedAt));

  useEffect(() => {
    if (!failedSeenStorageKey) {
      setLastSeenFailedAt(null);
      return;
    }

    setLastSeenFailedAt(window.localStorage.getItem(failedSeenStorageKey));
  }, [failedSeenStorageKey]);

  useEffect(() => {
    if (isKnownDashboardTabParam(tabParam)) {
      const timelineTab = getTimelineTabFromParam(tabParam);
      if (timelineTab) {
        setActiveTab(timelineTab);
      }
      router.replace("/", { scroll: false });
    }
  }, [tabParam, router]);

  useEffect(() => {
    if (activeTab !== "failed" || !failedSeenStorageKey || !latestFailedAt) {
      return;
    }

    window.localStorage.setItem(failedSeenStorageKey, latestFailedAt);
    setLastSeenFailedAt(latestFailedAt);
  }, [activeTab, failedSeenStorageKey, latestFailedAt]);

  const handleTabChange = (value: string) => {
    setActiveTab(value as TimelineTabType);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-6xl mx-auto px-[clamp(18px,4vw,48px)] py-6">
        <div className="mb-6 flex items-center gap-3 animate-reveal">
          <div className="section-kicker !mb-0">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">Dashboard</span>
          </div>
          <span className="h-3 w-px bg-border" />
          <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
            Your <span className="text-primary">posts</span>
          </h1>
        </div>

        <section className="animate-reveal animate-reveal-delay-1">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-primary">
              <CalendarDays className="h-3.5 w-3.5" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">Calendar</h2>
          </div>
          <ScheduleCalendar />
        </section>

        <section className="mt-8 animate-reveal animate-reveal-delay-2">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-primary">
              <FileText className="h-3.5 w-3.5" />
            </div>
            <h2 className="flex items-center text-lg font-semibold text-foreground">
              Drafts
              <TabCountBadge count={postCounts?.counts.drafts} />
            </h2>
          </div>
          <PostsList
            type="drafts"
            page={draftsPage}
            pageSize={draftsPageSize}
            onPageChange={setDraftsPage}
            onPageSizeChange={setDraftsPageSize}
          />
        </section>

        <section className="mt-8 animate-reveal animate-reveal-delay-2">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="mb-6">
              <TabsTrigger value="scheduled" className="gap-2">
                <Calendar className="h-3.5 w-3.5" />
                Scheduled
                <TabCountBadge count={postCounts?.counts.scheduled} />
              </TabsTrigger>
              <TabsTrigger value="past" className="gap-2">
                <CheckCircle className="h-3.5 w-3.5" />
                Published
                <TabCountBadge count={postCounts?.counts.past} />
              </TabsTrigger>
              <TabsTrigger value="failed" className="gap-2">
                <AlertCircle className="h-3.5 w-3.5" />
                Failed
                <TabCountBadge
                  count={failedCount}
                  tone={hasUnseenFailed ? "danger" : failedCount > 0 ? "danger-muted" : "default"}
                />
                {hasUnseenFailed ? (
                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-destructive shadow-[0_0_0_3px_rgba(239,68,68,0.22)]" />
                ) : null}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="scheduled" className="mt-0">
              <PostsList
                type="scheduled"
                page={scheduledPage}
                pageSize={scheduledPageSize}
                onPageChange={setScheduledPage}
                onPageSizeChange={setScheduledPageSize}
              />
            </TabsContent>

            <TabsContent value="past" className="mt-0">
              <PostsList
                type="past"
                page={postedPage}
                pageSize={postedPageSize}
                onPageChange={setPostedPage}
                onPageSizeChange={setPostedPageSize}
              />
            </TabsContent>

            <TabsContent value="failed" className="mt-0">
              <PostsList
                type="failed"
                page={failedPage}
                pageSize={failedPageSize}
                onPageChange={setFailedPage}
                onPageSizeChange={setFailedPageSize}
              />
            </TabsContent>
          </Tabs>
        </section>
      </main>
    </div>
  );
}
