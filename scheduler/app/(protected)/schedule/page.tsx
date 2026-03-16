"use client";

import { Navbar } from "@/components/navbar";
import { SchedulePostForm } from "@/components/schedule-post-form";

export default function SchedulePage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar breadcrumbs={[{ label: "Create Post" }]} />

      <main className="max-w-6xl mx-auto px-6 py-8">
        <SchedulePostForm />
      </main>
    </div>
  );
}
