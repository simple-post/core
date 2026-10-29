import { type NextRequest, NextResponse } from "next/server";

import { recordFunnelEvent } from "@/lib/analytics/events";
import { env } from "@/lib/env";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";
/** Browser observations cannot assert successful activation, payments or authoritative failures. */
export async function POST(req: NextRequest) {
  if (env.SELF_HOSTED) return new NextResponse(null, { status: 404 });
  if (req.headers.get("origin") !== new URL(env.NEXT_PUBLIC_APP_URL).origin)
    return new NextResponse(null, { status: 403 });
  try {
    const session = await requireBrowserSession(req);
    if (Number(req.headers.get("content-length")) > 512) return new NextResponse(null, { status: 413 });
    const raw = await req.text();
    if (raw.length > 512) return new NextResponse(null, { status: 413 });
    let body: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) return new NextResponse(null, { status: 400 });
      body = value as Record<string, unknown>;
    } catch {
      return new NextResponse(null, { status: 400 });
    }
    if (!["plan_viewed", "assistant_authorization_cancelled"].includes(String(body.kind)))
      return new NextResponse(null, { status: 400 });
    const kind = body.kind as "plan_viewed" | "assistant_authorization_cancelled";
    const plan = ["basic", "advanced", "pro"].includes(String(body.plan)) ? String(body.plan) : "none";
    // These are unique user/plan/day observations, deliberately bounded against retries and spam.
    await recordFunnelEvent(session.user.id, kind, {
      key: `${session.user.id}:${kind}:${plan}:${new Date().toISOString().slice(0, 10)}`,
      properties: { plan },
    });
    return NextResponse.json({ recorded: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error, req);
  }
}
