"use client";

import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { PostsList } from "@/components/posts-list";
import { UserMenu } from "@/components/user-menu";

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/30 bg-card/50 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-8 py-12">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <h1 className="text-4xl font-light text-foreground tracking-tight">Simple Post Scheduler</h1>
              <p className="text-muted-foreground text-lg font-light">Manage your content across platforms</p>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/schedule">
                <Button
                  size="lg"
                  className="gap-3 text-base font-medium px-8 py-3 rounded-xl shadow-sm hover:shadow-md transition-all duration-200">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create Post
                </Button>
              </Link>
              <UserMenu />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-16">
        <div className="space-y-20">
          {/* Upcoming Posts */}
          <section>
            <div className="mb-10">
              <h2 className="text-3xl font-serif font-light text-foreground mb-3 tracking-tight">Upcoming Posts</h2>
              <p className="text-muted-foreground text-lg font-light">Content scheduled for publication</p>
            </div>
            <Suspense fallback={<PostsListSkeleton />}>
              <PostsList type="scheduled" />
            </Suspense>
          </section>

          {/* Past Posts */}
          <section>
            <div className="mb-10">
              <h2 className="text-3xl font-serif font-light text-foreground mb-3 tracking-tight">Published Content</h2>
              <p className="text-muted-foreground text-lg font-light">Your content history and performance</p>
            </div>
            <Suspense fallback={<PostsListSkeleton />}>
              <PostsList type="past" />
            </Suspense>
          </section>
        </div>
      </main>
    </div>
    // </CHANGE>
  );
}

async function PostsCount({ type }: { type: "scheduled" | "published-today" | "total" }) {
  // This will be implemented with actual data fetching
  const count = type === "scheduled" ? 3 : type === "published-today" ? 1 : 12;
  return <div className="text-2xl font-bold">{count}</div>;
}

function PostsListSkeleton() {
  return (
    <div className="space-y-6">
      {[1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse">
          <div className="bg-card border border-border/50 rounded-2xl p-8 shadow-sm">
            <div className="flex gap-6">
              <div className="w-16 h-16 bg-muted rounded-xl" />
              <div className="flex-1 space-y-4">
                <div className="h-4 bg-muted rounded-lg w-3/4" />
                <div className="h-3 bg-muted rounded-lg w-1/2" />
                <div className="flex gap-3 pt-2">
                  <div className="h-6 bg-muted rounded-full w-16" />
                  <div className="h-6 bg-muted rounded-full w-16" />
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
