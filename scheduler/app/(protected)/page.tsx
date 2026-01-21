"use client";

import { useState } from "react";

import Link from "next/link";

import { Calendar, CheckCircle, AlertCircle } from "lucide-react";

import { PostsList } from "@/components/posts-list";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabType = "scheduled" | "past" | "failed";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabType>("scheduled");
  const [scheduledPage, setScheduledPage] = useState(1);
  const [postedPage, setPostedPage] = useState(1);
  const [failedPage, setFailedPage] = useState(1);

  // Reset page to 1 when switching tabs
  const handleTabChange = (value: string) => {
    setActiveTab(value as TabType);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <img src="/simplepost-logo.png" alt="SimplePost Logo" className="w-8 h-8 drop-shadow-lg" />
                <div>
                  <h1 className="text-xl font-bold text-foreground">SimplePost</h1>
                  <p className="text-xs text-muted-foreground">Scheduler</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/accounts">
                <Button variant="outline" size="default" className="gap-2">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                  Accounts
                </Button>
              </Link>
              <Link href="/schedule">
                <Button size="default" className="gap-2 shadow-sm">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create Post
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

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
            <PostsList type="scheduled" page={scheduledPage} onPageChange={setScheduledPage} />
          </TabsContent>

          <TabsContent value="past" className="mt-0">
            <PostsList type="past" page={postedPage} onPageChange={setPostedPage} />
          </TabsContent>

          <TabsContent value="failed" className="mt-0">
            <PostsList type="failed" page={failedPage} onPageChange={setFailedPage} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
