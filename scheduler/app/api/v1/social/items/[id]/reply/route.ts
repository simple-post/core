import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { SocialReplyRequestSchema } from "@/lib/openapi/schemas";
import { sendSocialReply } from "@/lib/social/activity";
import { handleApiError } from "@/lib/utils/errors";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth(req);
    const { id } = await params;
    const body = SocialReplyRequestSchema.parse(await req.json());
    return NextResponse.json(await sendSocialReply(session.user.id, { itemId: id, ...body }));
  } catch (error) {
    return handleApiError(error);
  }
}
