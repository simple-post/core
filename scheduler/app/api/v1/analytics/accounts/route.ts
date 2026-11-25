import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { canRefreshAnalytics, requirePostAnalytics } from "@/lib/post-analytics/access";
import { getAccountsAnalytics } from "@/lib/post-analytics/query";
import { AnalyticsRefreshModeSchema } from "@/lib/post-analytics/schemas";
import { refreshAccountAnalytics } from "@/lib/post-analytics/service";
import { handleApiError } from "@/lib/utils/errors";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req, { action: "read_account_analytics" }, true);
    await requirePostAnalytics(session.user.id);
    const refresh = AnalyticsRefreshModeSchema.parse(req.nextUrl.searchParams.get("refresh") ?? "none");
    if (refresh !== "none" && (await canRefreshAnalytics(session.user.id))) {
      await refreshAccountAnalytics({ userId: session.user.id, force: refresh === "force", reason: "manual" });
    }
    return NextResponse.json({ accounts: await getAccountsAnalytics(session.user.id) });
  } catch (error) {
    return handleApiError(error, req);
  }
}
