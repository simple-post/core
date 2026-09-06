import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";
import { getYouTubeLibrary } from "@/lib/youtube/readback";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(request, {
      action: "read_youtube_library",
      connectedAccountId: id,
      platform: "youtube",
    });
    const result = await getYouTubeLibrary(
      session.user.id,
      id,
      request.nextUrl.searchParams.get("pageToken") ?? undefined,
    );
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
