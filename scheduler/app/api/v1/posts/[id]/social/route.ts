import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { getPostSocialActivity } from "@/lib/social/activity";
import { handleApiError } from "@/lib/utils/errors";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth(req);
    const { id } = await params;
    return NextResponse.json(await getPostSocialActivity(session.user.id, id));
  } catch (error) {
    return handleApiError(error);
  }
}
