import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { canRefreshAnalytics } from "@/lib/post-analytics/access";
import { resolvePeriod } from "@/lib/post-analytics/periods";
import { listPostAnalytics } from "@/lib/post-analytics/query";
import { analyticsPostsQuerySchema, searchParamsToObject } from "@/lib/post-analytics/schemas";
import { ensureAnalyticsRowsForUser, refreshAnalyticsForUser } from "@/lib/post-analytics/service";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req, { action: "list_post_analytics" }, true);
    const query = analyticsPostsQuerySchema.parse(searchParamsToObject(req.nextUrl.searchParams));
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
          accounts: false,
        })
      : ensureAnalyticsRowsForUser(session.user.id, { since }));

    const result = await listPostAnalytics(session.user.id, {
      ...query,
      platforms: query.platform,
      accountIds: query.accountId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, req);
  }
}
