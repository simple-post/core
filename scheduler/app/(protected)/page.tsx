"use client";

import { useState, useEffect } from "react";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";

import { Calendar, CheckCircle, AlertCircle, Users, Plus } from "lucide-react";

import { Navbar } from "@/components/navbar";
import { PostsList } from "@/components/posts-list";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabType = "scheduled" | "past" | "failed";

export default function Dashboard() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get("tab") as TabType | null;

  const [activeTab, setActiveTab] = useState<TabType>(
    tabParam && ["scheduled", "past", "failed"].includes(tabParam) ? tabParam : "scheduled",
  );
  const [scheduledPage, setScheduledPage] = useState(1);
  const [postedPage, setPostedPage] = useState(1);
  const [failedPage, setFailedPage] = useState(1);
  const [scheduledPageSize, setScheduledPageSize] = useState(25);
  const [postedPageSize, setPostedPageSize] = useState(25);
  const [failedPageSize, setFailedPageSize] = useState(25);

  // Update tab when URL param changes
  useEffect(() => {
    if (tabParam && ["scheduled", "past", "failed"].includes(tabParam)) {
      setActiveTab(tabParam);
      // Clean up URL by removing the tab param
      router.replace("/", { scroll: false });
    }
  }, [tabParam, router]);

  // Reset page to 1 when switching tabs
  const handleTabChange = (value: string) => {
    setActiveTab(value as TabType);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar
        actions={
          <>
            <Link href="/accounts">
              <Button variant="outline" size="sm" className="gap-2">
                <Users className="h-4 w-4" />
                <span className="hidden sm:inline">Accounts</span>
              </Button>
            </Link>
            <Link href="/schedule">
              <Button size="sm" className="gap-2 shadow-sm">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Create Post</span>
              </Button>
            </Link>
          </>
        }
      />

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-foreground mb-2">Your Posts</h2>
          <p className="text-muted-foreground">Manage your scheduled, published, and failed posts</p>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="mb-6">
            <TabsTrigger value="scheduled" className="gap-2">
              <Calendar className="h-4 w-4" />
              Scheduled
            </TabsTrigger>
            <TabsTrigger value="past" className="gap-2">
              <CheckCircle className="h-4 w-4" />
              Posted
            </TabsTrigger>
            <TabsTrigger value="failed" className="gap-2">
              <AlertCircle className="h-4 w-4" />
              Failed
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
      </main>
    </div>
  );
}
