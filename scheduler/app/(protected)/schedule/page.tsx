"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SchedulePostForm } from "@/components/schedule-post-form";

export default function SchedulePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <img src="/simplepost-logo.png" alt="SimplePost Logo" className="w-7 h-7 drop-shadow-lg" />
              <h1 className="text-xl font-bold text-foreground">Create Post</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <SchedulePostForm />
      </main>
    </div>
  );
}
