import crypto from "node:crypto";

import { after, type NextRequest, NextResponse } from "next/server";

import { relayOpenAiMilestones } from "@/lib/analytics/openai-ads";
import { env } from "@/lib/env";
import { createLogger, serializeError } from "@/lib/logger";
import { runBackgroundAnalyticsRefresh } from "@/lib/post-analytics/background";
import { dispatchDueScheduledPosts } from "@/lib/posting/scheduled-dispatcher";
import { runBackgroundInboxRefresh } from "@/lib/social/activity";

const log = createLogger("api:internal:scheduled-dispatch");

function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization") || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return false;
  }

  const expected = env.SCHEDULED_POST_DISPATCH_SECRET;
  const tokenBuffer = Buffer.from(token, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (tokenBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await dispatchDueScheduledPosts();
    // Measurement runs after publishing and cannot turn a successful dispatch into a failure.
    try {
      const measurement = await relayOpenAiMilestones();
      if (measurement.failed)
        log.warn({ errorCode: measurement.error }, "OpenAI measurement delivery did not accept all events");
    } catch {
      log.warn(
        { errorCode: "measurement_database_failure" },
        "OpenAI measurement relay failed; publishing results are preserved",
      );
    }
    // Analytics upkeep runs last and can never turn a successful dispatch into a failure.
    try {
      const analytics = await runBackgroundAnalyticsRefresh();
      if (!analytics.skipped && (analytics.posts.refreshed > 0 || analytics.accounts > 0))
        log.info({ analytics }, "Refreshed post analytics");
    } catch (error) {
      log.warn({ err: serializeError(error) }, "Background analytics refresh failed; publishing results are preserved");
    }
    after(async () => {
      try {
        const inbox = await runBackgroundInboxRefresh();
        if (inbox?.accounts.length) {
          log.info(
            {
              checked: inbox.accounts.length,
              readsSucceeded: inbox.accounts.reduce((total, account) => total + account.processed, 0),
              failed: inbox.accounts.filter((account) => account.error).length,
            },
            "Refreshed social inbox",
          );
        }
      } catch (error) {
        log.warn({ err: serializeError(error) }, "Background social inbox refresh failed");
      }
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    log.error({ err: serializeError(error) }, "Scheduled dispatch failed");
    return NextResponse.json({ error: "Scheduled dispatch failed" }, { status: 500 });
  }
}
