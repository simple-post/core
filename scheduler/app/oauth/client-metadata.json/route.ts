import { NextResponse } from "next/server";

import { getBlueskyClientMetadata } from "@/lib/oauth/bluesky-client";

/**
 * AT Protocol OAuth client metadata. Bluesky fetches this document using the
 * URL supplied as BLUESKY_CLIENT_ID before it accepts an authorization request.
 */
export function GET() {
  return NextResponse.json(getBlueskyClientMetadata(), {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
