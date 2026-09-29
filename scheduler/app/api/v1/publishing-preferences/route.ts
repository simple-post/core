import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import {
  publishingSettingsSchema,
  readPublishingPreferences,
  updatePublishingPreferences,
} from "@/lib/preferences/publishing";
import { handleApiError } from "@/lib/utils/errors";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    return NextResponse.json(await readPublishingPreferences(session.user.id));
  } catch (error) {
    return handleApiError(error, req);
  }
}
export async function PATCH(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    return NextResponse.json(
      await updatePublishingPreferences(session.user.id, publishingSettingsSchema.parse(await req.json())),
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
