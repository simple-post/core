"use client";

import { useState, useEffect } from "react";

import { useSearchParams, useRouter } from "next/navigation";

import { Calendar, CheckCircle, AlertCircle, FileText } from "lucide-react";

import { Navbar } from "@/components/navbar";
import { PostsList } from "@/components/posts-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePostCounts } from "@/hooks/use-posts";
import { useSession } from "@/lib/auth/auth-client";
import { cn } from "@/lib/utils";

type TabType = "drafts" | "scheduled" | "past" | "failed";
const TABS = new Set<TabType>(["drafts", "scheduled", "past", "failed"]);
const FAILED_SEEN_STORAGE_KEY_PREFIX = "simplepost:dashboard:last-seen-failed-at:v1";

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
  const tabParam = searchParams.get("tab") as TabType | null;
  const { data: session } = useSession();
  const { data: postCounts } = usePostCounts();

  const [activeTab, setActiveTab] = useState<TabType>(tabParam && TABS.has(tabParam) ? tabParam : "scheduled");
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

  // Update tab when URL param changes
  useEffect(() => {
    if (tabParam && TABS.has(tabParam)) {
      setActiveTab(tabParam);
      // Clean up URL by removing the tab param
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

  // Reset page to 1 when switching tabs
  const handleTabChange = (value: string) => {
    setActiveTab(value as TabType);
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

        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="w-full animate-reveal animate-reveal-delay-1">
          <TabsList className="mb-6">
            <TabsTrigger value="drafts" className="gap-2">
              <FileText className="h-3.5 w-3.5" />
              Drafts
              <TabCountBadge count={postCounts?.counts.drafts} />
            </TabsTrigger>
            <TabsTrigger value="scheduled" className="gap-2">
              <Calendar className="h-3.5 w-3.5" />
              Scheduled
              <TabCountBadge count={postCounts?.counts.scheduled} />
            </TabsTrigger>
            <TabsTrigger value="past" className="gap-2">
              <CheckCircle className="h-3.5 w-3.5" />
              Posted
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

          <TabsContent value="drafts" className="mt-0">
            <PostsList
              type="drafts"
              page={draftsPage}
              pageSize={draftsPageSize}
              onPageChange={setDraftsPage}
              onPageSizeChange={setDraftsPageSize}
            />
          </TabsContent>

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
      </main>
    </div>
  );
}
