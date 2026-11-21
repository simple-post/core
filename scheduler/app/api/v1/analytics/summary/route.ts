import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { canRefreshAnalytics } from "@/lib/post-analytics/access";
import { resolvePeriod } from "@/lib/post-analytics/periods";
import { getAnalyticsSummary } from "@/lib/post-analytics/query";
import { analyticsSummaryQuerySchema, searchParamsToObject } from "@/lib/post-analytics/schemas";
import { ensureAnalyticsRowsForUser, refreshAnalyticsForUser } from "@/lib/post-analytics/service";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req, { action: "read_analytics_summary" }, true);
    const query = analyticsSummaryQuerySchema.parse(searchParamsToObject(req.nextUrl.searchParams));
    let period;
    try {
      period = resolvePeriod(query);
    } catch (error) {
      throw new BadRequestError(error instanceof Error ? error.message : "Invalid period");
    }

    const since = query.period === "all_time" ? undefined : period.start;
    await (query.refresh && query.refresh !== "none" && (await canRefreshAnalytics(session.user.id))
      ? refreshAnalyticsForUser(session.user.id, {
          since,
          force: query.refresh === "force",
        })
      : ensureAnalyticsRowsForUser(session.user.id, { since }));

    const summary = await getAnalyticsSummary(session.user.id, {
      ...query,
      platforms: query.platform,
      accountIds: query.accountId,
    });
    return NextResponse.json({ summary });
  } catch (error) {
    return handleApiError(error, req);
  }
}
