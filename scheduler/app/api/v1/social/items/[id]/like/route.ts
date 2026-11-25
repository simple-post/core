import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { sendSocialLike } from "@/lib/social/activity";
import { inboxItemIdSchema } from "@/lib/social/schemas";
import { handleApiError } from "@/lib/utils/errors";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth(req);
    const { id } = await params;
    return NextResponse.json(await sendSocialLike(session.user.id, inboxItemIdSchema.parse(id)));
  } catch (error) {
    return handleApiError(error, req);
  }
}
