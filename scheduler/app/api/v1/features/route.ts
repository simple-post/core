import { type NextRequest, NextResponse } from "next/server";

import { getUserFeatures, hasFeature } from "@/lib/features";
import { requireBrowserSession, requireReadAuth } from "@/lib/middleware/auth";
import { handleApiError, PaymentRequiredError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

async function featuresForRequest(req: NextRequest) {
  try {
    const session = await requireReadAuth(req);
    return await getUserFeatures(session.user.id);
  } catch (error) {
    if (!(error instanceof PaymentRequiredError) || req.headers.has("authorization")) throw error;
    // Planning is available to the private pilot even without personal publishing access.
    const session = await requireBrowserSession(req);
    if (await hasFeature(session.user.id, "TEAM_WORKSPACES")) return ["TEAM_WORKSPACES"];
    throw error;
  }
}

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(
      { features: await featuresForRequest(req) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
