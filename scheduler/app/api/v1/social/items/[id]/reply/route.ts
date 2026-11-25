import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { sendSocialReply } from "@/lib/social/activity";
import { inboxItemIdSchema, inboxReplySchema } from "@/lib/social/schemas";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth(req);
    const { id } = await params;
    const itemId = inboxItemIdSchema.parse(id);
    const body = inboxReplySchema.parse(
      await req.json().catch(() => {
        throw new BadRequestError("Expected a reply JSON object.");
      }),
    );
    return NextResponse.json(await sendSocialReply(session.user.id, { itemId, ...body }));
  } catch (error) {
    return handleApiError(error, req);
  }
}
