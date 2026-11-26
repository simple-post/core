import { Suspense } from "react";

import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { AnalyticsDashboard } from "@/components/analytics/dashboard/analytics-dashboard";
import { Navbar } from "@/components/navbar";
import { auth } from "@/lib/auth/auth";
import { hasFeature } from "@/lib/features";
import { workspaceConnections } from "@/lib/workspaces/connections";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user || !(await hasFeature(session.user.id, "POST_ANALYTICS"))) notFound();
  const { workspace } = await searchParams;
  const scope = await workspaceConnections(session.user.id, workspace ?? null).catch(() => null);
  if (!scope) notFound();
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <Suspense>
        <AnalyticsDashboard
          key={workspace ?? "personal"}
          workspaceId={scope.workspaceId ?? undefined}
          canManage={scope.canManage}
        />
      </Suspense>
    </div>
  );
}
