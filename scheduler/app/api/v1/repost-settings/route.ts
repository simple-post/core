import { type NextRequest, NextResponse } from "next/server";

import { RepostSettingsSchema } from "@simple-post/sdk";

import { requireAuth } from "@/lib/middleware/auth";
import { getUserRepostSettings, updateUserRepostSettings } from "@/lib/repost/settings";
import { handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const settings = await getUserRepostSettings(session.user.id);
    return NextResponse.json({ settings });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const body = await req.json();
    const settings = RepostSettingsSchema.parse(body);
    const saved = await updateUserRepostSettings(session.user.id, settings);
    return NextResponse.json({ settings: saved });
  } catch (error) {
    return handleApiError(error);
  }
}
