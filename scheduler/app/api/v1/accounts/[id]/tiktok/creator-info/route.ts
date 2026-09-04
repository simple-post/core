import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { getAccountTikTokCreatorInfo } from "@/lib/tiktok/account-creator-info";
import { handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(request, {
      action: "load_tiktok_creator_info",
      connectedAccountId: id,
      platform: "tiktok",
    });

    const creatorInfo = await getAccountTikTokCreatorInfo(session.user.id, id);

    return NextResponse.json(
      { creatorInfo },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
