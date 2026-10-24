import { type NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { requireAuth } from "@/lib/middleware/auth";
import { scheduleTikTokRetry } from "@/lib/posting/schedule-tiktok-retry";
import { handleApiError } from "@/lib/utils/errors";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth(req);
    const { id } = await params;
    const input = z
      .object({ scheduledFor: z.iso.datetime({ offset: true }), expectedUpdatedAt: z.iso.datetime().optional() })
      .parse(await req.json());
    const post = await scheduleTikTokRetry(session.user.id, id, input.scheduledFor, input.expectedUpdatedAt);
    return NextResponse.json({
      post,
      message: "Retry scheduled. TikTok may still require action in its app; acceptance is not guaranteed.",
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}
