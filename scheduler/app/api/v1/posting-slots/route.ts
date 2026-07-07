import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { getUserPostingSlots, postingSlotsRequestSchema, updateUserPostingSlots } from "@/lib/posting-slots/settings";
import { handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const slots = await getUserPostingSlots(session.user.id);
    return NextResponse.json({ slots });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const body = await req.json();
    const { slots } = postingSlotsRequestSchema.parse(body);
    const saved = await updateUserPostingSlots(session.user.id, slots);
    return NextResponse.json({ slots: saved });
  } catch (error) {
    return handleApiError(error);
  }
}
