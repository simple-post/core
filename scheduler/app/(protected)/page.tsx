"use client";

import { useState, useEffect } from "react";

import { useSearchParams, useRouter } from "next/navigation";

import { TrialBanner } from "@/components/billing/trial-banner";
import { CreatePostWebMcp } from "@/components/create-post-webmcp";
import { DashboardStatusTabs } from "@/components/dashboard-status-tabs";
import { OnboardingModal } from "@/components/onboarding/onboarding-modal";
import { PostsDashboard } from "@/components/posts-dashboard";
import { PostsList } from "@/components/posts-list";
import { ScheduleCalendar } from "@/components/schedule-calendar";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TeamScreen } from "@/components/workspaces/team-screen";
import { usePostCounts } from "@/hooks/use-posts";
import { useSession } from "@/lib/auth/auth-client";

type TimelineTabType = "drafts" | "scheduled" | "past" | "failed";
const TIMELINE_TABS = new Set<TimelineTabType>(["drafts", "scheduled", "past", "failed"]);
const FAILED_SEEN_STORAGE_KEY_PREFIX = "simplepost:dashboard:last-seen-failed-at:v1";
function getTimelineTabFromParam(value: string | null): TimelineTabType | null {
  if (!value) return null;
  if (value === "published" || value === "posted") return "past";
  return TIMELINE_TABS.has(value as TimelineTabType) ? (value as TimelineTabType) : null;
}

export default function Dashboard() {
  const id = useSearchParams().get("workspace");
  return id ? <TeamScreen key={id} id={id} view="dashboard" /> : <PersonalDashboard />;
}
function PersonalDashboard() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get("tab");
  const { data: session } = useSession();
  const { data: postCounts } = usePostCounts();

  const [activeTab, setActiveTab] = useState<TimelineTabType>(getTimelineTabFromParam(tabParam) ?? "drafts");
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
    const timelineTab = getTimelineTabFromParam(tabParam);

    if (timelineTab) {
      setActiveTab(timelineTab);

      // Keep old links working, but leave the canonical tab in the URL so
      // navigating back from a post restores the same dashboard section.
      if (tabParam !== timelineTab) {
        router.replace(`/?tab=${timelineTab}`, { scroll: false });
      }
      return;
    }

    setActiveTab("drafts");
    if (tabParam) {
      router.replace("/?tab=drafts", { scroll: false });
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
    const nextTab = value as TimelineTabType;
    setActiveTab(nextTab);
    router.replace(`/?tab=${nextTab}`, { scroll: false });
  };

  return (
    <PostsDashboard
      notices={
        <>
          <TrialBanner />
          <OnboardingModal />
          <CreatePostWebMcp />
        </>
      }
      calendar={<ScheduleCalendar />}>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <DashboardStatusTabs counts={postCounts?.counts} hasUnseenFailed={hasUnseenFailed} />
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
    </PostsDashboard>
  );
}
