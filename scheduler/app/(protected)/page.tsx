"use client";

import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { PostsList } from "@/components/posts-list";

export default function Dashboard() {
  const sections: Array<{
    id: "scheduled" | "failed" | "past";
    title: string;
    description: string;
  }> = [
    {
      id: "scheduled",
      title: "Upcoming Posts",
      description: "Content scheduled for publication",
    },
    {
      id: "failed",
      title: "Failed Posts",
      description: "Posts that failed to publish - review and retry if needed",
    },
    {
      id: "past",
      title: "Published Content",
      description: "Your content history and performance",
    },
  ];

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

      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="space-y-16">
          {sections.map((section) => (
            <section key={section.id}>
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-foreground mb-2">{section.title}</h2>
                <p className="text-muted-foreground">{section.description}</p>
              </div>
              <Suspense fallback={<PostsListSkeleton />}>
                <PostsList type={section.id} />
              </Suspense>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

function PostsListSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse">
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex gap-4">
              <div className="w-14 h-14 bg-muted rounded-lg" />
              <div className="flex-1 space-y-3">
                <div className="h-4 bg-muted rounded w-3/4" />
                <div className="h-3 bg-muted rounded w-1/2" />
                <div className="flex gap-2 pt-2">
                  <div className="h-5 bg-muted rounded-full w-14" />
                  <div className="h-5 bg-muted rounded-full w-14" />
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
