import { NextResponse } from "next/server";

import { getOidcJwks } from "@/lib/mcp/oidc";

export function GET() {
  return NextResponse.json(getOidcJwks(), {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
