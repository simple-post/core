import { type NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { createLogger, serializeError } from "@/lib/logger";
import { getSession } from "@/lib/middleware/auth";

const log = createLogger("api:internal:client-errors");

const MAX_BODY_BYTES = 16_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

const clientErrorSchema = z.object({
  level: z.enum(["error", "warn"]).default("error"),
  message: z.string().max(500).default("Client error"),
  error: z.record(z.unknown()).optional(),
  context: z.record(z.unknown()).optional(),
  url: z.string().max(2000).optional(),
  userAgent: z.string().max(500).optional(),
  timestamp: z.string().max(80).optional(),
});

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function getClientKey(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    req.headers.get("user-agent") ||
    "unknown"
  );
}

/**
 * Best-effort same-origin check. Browsers always send an `Origin` header on
 * cross-origin (and same-origin POST) requests, so a mismatched origin is a
 * strong signal of cross-site abuse. A missing Origin is allowed (e.g.
 * sendBeacon / non-browser callers); the IP rate limit and the server-side
 * Telegram cap remain the backstop against spoofed direct requests.
 */
function isAllowedOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;

  try {
    const originHost = new URL(origin).host;
    const allowedHosts = new Set<string>([new URL(req.url).host]);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl) {
      try {
        allowedHosts.add(new URL(appUrl).host);
      } catch {
        // Ignore a malformed NEXT_PUBLIC_APP_URL.
      }
    }
    return allowedHosts.has(originHost);
  } catch {
    return false;
  }
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

export async function POST(req: NextRequest) {
  if (!isAllowedOrigin(req)) {
    return new NextResponse(null, { status: 403 });
  }

  const clientKey = getClientKey(req);
  if (isRateLimited(clientKey)) {
    log.warn({ clientKey }, "Client error log rate limit exceeded");
    return new NextResponse(null, { status: 204 });
  }

  try {
    const bodyText = await req.text();
    if (bodyText.length > MAX_BODY_BYTES) {
      log.warn({ clientKey, bodyLength: bodyText.length }, "Rejected oversized client error payload");
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    const payload = clientErrorSchema.parse(JSON.parse(bodyText));
    const session = await getSession(req).catch(() => null);
    const userId = session?.user?.id;

    const logPayload = {
      err: payload.error,
      userId,
      clientKey,
      client: {
        url: payload.url,
        userAgent: payload.userAgent,
        timestamp: payload.timestamp,
      },
      context: payload.context,
    };

    if (payload.level === "warn") {
      log.warn(logPayload, payload.message);
    } else {
      log.error(logPayload, payload.message);
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    log.warn({ err: serializeError(error), clientKey }, "Invalid client error payload");
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
}
