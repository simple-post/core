"use client";

import { Navbar } from "@/components/navbar";
import { SchedulePostForm } from "@/components/schedule-post-form";

export default function SchedulePage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-6xl mx-auto px-[clamp(18px,4vw,48px)] py-6">
        <div className="mb-6 animate-reveal">
          <div className="flex items-center gap-3">
            <div className="section-kicker !mb-0">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">Compose</span>
            </div>
            <span className="h-3 w-px bg-border" />
            <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
              Create a <span className="text-primary">post</span>
            </h1>
          </div>
        </div>
        <SchedulePostForm />
      </main>
    </div>
  );
}
