import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import { createLogger, serializeError } from "@/lib/logger";
import { dispatchDueScheduledPosts } from "@/lib/posting/scheduled-dispatcher";

const log = createLogger("api:internal:scheduled-dispatch");

function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization") || "";
  const [scheme, token] = authHeader.split(" ");

  return scheme?.toLowerCase() === "bearer" && token === env.SCHEDULED_POST_DISPATCH_SECRET;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await dispatchDueScheduledPosts();
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    log.error({ err: serializeError(error) }, "Scheduled dispatch failed");
    return NextResponse.json({ error: "Scheduled dispatch failed" }, { status: 500 });
  }
}
