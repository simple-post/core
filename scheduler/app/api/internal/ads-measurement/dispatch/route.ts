import { timingSafeEqual } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";

import { relayOpenAiMilestones } from "@/lib/analytics/openai-ads";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:internal:ads-measurement");
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const [scheme, token] = (req.headers.get("authorization") || "").split(" ");
  const expected = Buffer.from(env.SCHEDULED_POST_DISPATCH_SECRET);
  const actual = Buffer.from(token || "");
  if (
    scheme?.toLowerCase() !== "bearer" ||
    !token ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await relayOpenAiMilestones();
    if (result.failed) log.warn({ errorCode: result.error }, "OpenAI conversion delivery deferred");
    return NextResponse.json(result, { status: result.failed ? 502 : 200 });
  } catch {
    log.warn({ errorCode: "measurement_database_failure" }, "OpenAI conversion relay failed");
    return NextResponse.json({ error: "Conversion delivery deferred" }, { status: 503 });
  }
}
