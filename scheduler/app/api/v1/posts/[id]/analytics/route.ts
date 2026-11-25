import { type NextRequest, NextResponse } from "next/server";

import { serverMessage } from "@/lib/i18n/server";
import { requireAuth } from "@/lib/middleware/auth";
import { canRefreshAnalytics, requirePostAnalytics } from "@/lib/post-analytics/access";
import { getPostAnalyticsView } from "@/lib/post-analytics/query";
import { AnalyticsRefreshModeSchema } from "@/lib/post-analytics/schemas";
import { ensureAnalyticsRowsForUser, refreshAnalyticsForUser } from "@/lib/post-analytics/service";
import { handleApiError, NotFoundError } from "@/lib/utils/errors";

/**
 * Analytics for one post across all accounts it was published to. Stale
 * values are refreshed from the platforms first unless refresh=none.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(req, { action: "read_post_analytics", postId: id }, true);
    await requirePostAnalytics(session.user.id);
    const refresh = AnalyticsRefreshModeSchema.parse(req.nextUrl.searchParams.get("refresh") ?? "auto");

    await ensureAnalyticsRowsForUser(session.user.id, { postIds: [id] });
    const exists = await getPostAnalyticsView(session.user.id, id);
    if (!exists) throw new NotFoundError(serverMessage("Post not found"));

    if (refresh !== "none" && (await canRefreshAnalytics(session.user.id))) {
      await refreshAnalyticsForUser(session.user.id, {
        postIds: [id],
        force: refresh === "force",
        budgetMs: 12_000,
        accounts: false,
      });
      const analytics = await getPostAnalyticsView(session.user.id, id);
      return NextResponse.json({ analytics });
    }
    return NextResponse.json({ analytics: exists });
  } catch (error) {
    return handleApiError(error, req);
  }
}
