"use client";

import { BackLink } from "@/components/back-link";
import { Navbar } from "@/components/navbar";
import { SchedulePostForm } from "@/components/schedule-post-form";

export default function SchedulePage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-4">
          <BackLink />
        </div>
        <SchedulePostForm />
      </main>
    </div>
  );
}
