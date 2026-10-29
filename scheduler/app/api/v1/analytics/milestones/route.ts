import { type NextRequest, NextResponse } from "next/server";

import { acknowledgeMilestones, claimMilestoneEvents } from "@/lib/analytics/activation";
import { syncLastNonDirectTouch } from "@/lib/analytics/sync-touch";
import { env } from "@/lib/env";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

/**
 * Claims first-time activation milestones for the signed-in browser to relay to
 * Plausible. Hosted only; the response contains event names and public labels, never
 * user IDs, emails or content; opaque delivery IDs stay in the browser. Like onboarding, this stays available after a trial expires.
 */
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(env.NEXT_PUBLIC_APP_URL).origin)
    return new NextResponse(null, { status: 403 });
  try {
    const session = await requireBrowserSession(req);
    if (env.SELF_HOSTED)
      return NextResponse.json({ events: [] }, { headers: { "Cache-Control": "private, no-store" } });
    await syncLastNonDirectTouch(session.user.id, req.headers.get("cookie") || "");
    // A missing relay protocol is an older cached client. It must not lease events it cannot acknowledge.
    if (Number(req.headers.get("content-length")) > 4096) return new NextResponse(null, { status: 413 });
    const raw = await req.text();
    if (raw.length > 4096) return new NextResponse(null, { status: 413 });
    const body = await Promise.resolve()
      .then(() => JSON.parse(raw))
      .catch(() => ({}));
    if (!body || typeof body !== "object" || body.protocol !== 2)
      return NextResponse.json({ events: [] }, { headers: { "Cache-Control": "private, no-store" } });
    if (typeof body.claimToken === "string" && body.claimToken.length <= 100) {
      const delivered = Array.isArray(body.delivered)
        ? body.delivered.filter((v: unknown): v is string => typeof v === "string" && v.length <= 60).slice(0, 20)
        : [];
      await acknowledgeMilestones(session.user.id, body.claimToken, delivered);
      return NextResponse.json({ acknowledged: true }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const batch = await claimMilestoneEvents(session.user.id);
    return NextResponse.json(batch, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error, req);
  }
}
