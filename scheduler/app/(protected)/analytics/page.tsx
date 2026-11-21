"use client";

import { Suspense } from "react";

import { AnalyticsDashboard } from "@/components/analytics/dashboard/analytics-dashboard";
import { Navbar } from "@/components/navbar";

export default function AnalyticsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <Suspense>
        <AnalyticsDashboard />
      </Suspense>
    </div>
  );
}
