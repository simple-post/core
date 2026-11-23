import { type NextRequest, NextResponse } from "next/server";

import { syncAdsPermission } from "@/lib/analytics/ads-permission";
import { openAiAdsConfigured } from "@/lib/analytics/openai-ads";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const origins = new Set([
  "https://app.simplepost.social",
  "https://simplepost.social",
  "https://www.simplepost.social",
]);

function respond(req: NextRequest, body: unknown, status = 200) {
  const origin = req.headers.get("origin");
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Vary: "Origin",
      ...(origin && origins.has(origin)
        ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" }
        : {}),
    },
  });
}

export async function OPTIONS(req: NextRequest) {
  const response = respond(req, {}, origins.has(req.headers.get("origin") || "") ? 200 : 403);
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  const row = session?.user.id
    ? await prisma.openAiAdsMeasurement.findUnique({ where: { userId: session.user.id } })
    : null;
  return respond(req, {
    // Legacy clients use enabled to show the retired popup; keep it off.
    enabled: false,
    automaticEnrollment: openAiAdsConfigured(),
    sharingEnabled: Boolean(row && !row.permissionRevokedAt),
    preference: row ? (row.permissionRevokedAt ? "declined" : "allowed") : null,
  });
}

export async function POST(req: NextRequest) {
  // Browser-only preference: no cross-origin requests, CLI tokens or arbitrary user IDs.
  if (!origins.has(req.headers.get("origin") || "")) return respond(req, { error: "Invalid origin" }, 403);
  let body: { allowed?: unknown; sync?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* Invalid JSON. */
  }
  if (!body || (typeof body.allowed !== "boolean" && body.sync !== true))
    return respond(req, { error: "Choose a preference" }, 400);
  if (body.allowed === true)
    return respond(req, { error: "Measurement is managed automatically; this endpoint supports opting out" }, 410);
  const session = await auth.api.getSession({ headers: req.headers });
  if (body.allowed === false && !session?.user.id)
    return respond(req, { error: "Sign in to withdraw permission" }, 401);
  if (session?.user.id)
    await syncAdsPermission(
      session.user.id,
      req.headers.get("cookie") || "",
      typeof body.allowed === "boolean" ? body.allowed : undefined,
    );
  return respond(req, { saved: true });
}
