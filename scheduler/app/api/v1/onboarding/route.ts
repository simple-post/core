import { type NextRequest, NextResponse } from "next/server";

import { requireBrowserSession } from "@/lib/middleware/auth";
import { getOnboardingState } from "@/lib/onboarding/state";
import { handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

/**
 * Deliberately not behind `requireAuth`: onboarding guidance has to stay
 * readable when the trial has expired, which is exactly when the billing gate
 * would reject the request.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireBrowserSession(req);
    const state = await getOnboardingState(session.user.id);

    return NextResponse.json(state, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
