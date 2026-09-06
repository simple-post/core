import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";
import { getYouTubeVideo } from "@/lib/youtube/readback";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; videoId: string }> }) {
  try {
    const { id, videoId } = await params;
    const session = await requireAuth(request, {
      action: "read_youtube_video",
      connectedAccountId: id,
      platform: "youtube",
    });
    const result = await getYouTubeVideo(
      session.user.id,
      id,
      videoId,
      request.nextUrl.searchParams.get("playlistId") ?? undefined,
    );
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
