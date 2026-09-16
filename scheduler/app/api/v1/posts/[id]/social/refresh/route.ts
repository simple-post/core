import { type NextRequest, NextResponse } from "next/server";

import * as z from "zod";

import { requireAuth } from "@/lib/middleware/auth";
import { refreshPostSocialActivity } from "@/lib/social/activity";
import { handleApiError } from "@/lib/utils/errors";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth(req);
    const { id } = await params;
    const body = z.object({ reset: z.boolean().optional() }).parse(await req.json().catch(() => ({})));
    return NextResponse.json(await refreshPostSocialActivity(session.user.id, id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
