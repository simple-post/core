import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { canRefreshAnalytics, requirePostAnalytics } from "@/lib/post-analytics/access";
import { resolvePeriod } from "@/lib/post-analytics/periods";
import { getAnalyticsSummary } from "@/lib/post-analytics/query";
import { analyticsSummaryQuerySchema, searchParamsToObject } from "@/lib/post-analytics/schemas";
import { ensureAnalyticsRowsForUser, refreshAnalyticsForUser } from "@/lib/post-analytics/service";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";
import { workspaceConnections } from "@/lib/workspaces/connections";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req, { action: "read_analytics_summary" }, true);
    await requirePostAnalytics(session.user.id);
    const { userId, workspaceId, canManage } = await workspaceConnections(
      session.user.id,
      req.nextUrl.searchParams.get("workspace"),
    );
    const query = analyticsSummaryQuerySchema.parse(searchParamsToObject(req.nextUrl.searchParams));
    let period;
    try {
      period = resolvePeriod(query);
    } catch (error) {
      throw new BadRequestError(error instanceof Error ? error.message : "Invalid period");
    }

    // Activity covers gains on older posts too, so it is not limited to posts published in the period.
    const since = query.period === "all_time" || query.mode === "activity" ? undefined : period.start;
    await (canManage && query.refresh && query.refresh !== "none" && (await canRefreshAnalytics(session.user.id))
      ? refreshAnalyticsForUser(userId, {
          workspaceId,
          since,
          force: query.refresh === "force",
        })
      : ensureAnalyticsRowsForUser(userId, { since, workspaceId }));

    const summary = await getAnalyticsSummary(userId, {
      ...query,
      workspaceId,
      platforms: query.platform,
      accountIds: query.accountId,
    });
    return NextResponse.json({ summary });
  } catch (error) {
    return handleApiError(error, req);
  }
}
