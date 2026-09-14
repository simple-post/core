import { type NextRequest, NextResponse } from "next/server";

import * as z from "zod";

import { requireAuth } from "@/lib/middleware/auth";
import { refreshSocialInbox } from "@/lib/social/activity";
import { handleApiError } from "@/lib/utils/errors";

const requestSchema = z.object({ includeMentions: z.boolean().optional(), reset: z.boolean().optional() });

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const body = requestSchema.parse(await req.json().catch(() => ({})));
    return NextResponse.json(await refreshSocialInbox(session.user.id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
