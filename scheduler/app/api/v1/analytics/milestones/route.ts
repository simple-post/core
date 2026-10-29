import { type NextRequest, NextResponse } from "next/server";

import { claimMilestoneEvents } from "@/lib/analytics/activation";
import { env } from "@/lib/env";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

/**
 * Claims first-time activation milestones for the signed-in browser to relay to
 * Plausible. Hosted only; the response contains event names and public labels, never
 * IDs, emails or content. Like onboarding, this stays available after a trial expires.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireBrowserSession(req);
    if (env.SELF_HOSTED)
      return NextResponse.json({ events: [] }, { headers: { "Cache-Control": "private, no-store" } });
    const events = await claimMilestoneEvents(session.user.id);
    return NextResponse.json({ events }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error, req);
  }
}
