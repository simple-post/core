import { Suspense } from "react";

import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { AnalyticsDashboard } from "@/components/analytics/dashboard/analytics-dashboard";
import { Navbar } from "@/components/navbar";
import { auth } from "@/lib/auth/auth";
import { hasFeature } from "@/lib/features";

export default async function AnalyticsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user || !(await hasFeature(session.user.id, "POST_ANALYTICS"))) notFound();
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <Suspense>
        <AnalyticsDashboard />
      </Suspense>
    </div>
  );
}
