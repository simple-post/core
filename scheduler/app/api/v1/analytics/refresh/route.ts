import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { resolvePeriod } from "@/lib/post-analytics/periods";
import { analyticsRefreshRequestSchema } from "@/lib/post-analytics/schemas";
import { refreshAnalyticsForUser } from "@/lib/post-analytics/service";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";

/**
 * Refreshes stale analytics from the platforms (all recent posts, a period,
 * or specific posts). Bounded in time; call again to continue when
 * `posts.skipped` is non-zero.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req, { action: "refresh_analytics" });
    const body = analyticsRefreshRequestSchema.parse(await req.json().catch(() => ({})));
    let since: Date | undefined;
    if (!body.postIds && body.period !== "all_time") {
      try {
        since = resolvePeriod({ ...body, period: body.period ?? "last_90d" }).start;
      } catch (error) {
        throw new BadRequestError(error instanceof Error ? error.message : "Invalid period");
      }
    }
    const result = await refreshAnalyticsForUser(session.user.id, {
      since,
      postIds: body.postIds,
      force: body.force,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, req);
  }
}
