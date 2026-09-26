import { createHash, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";
import { limitedBody } from "@/lib/experiments/body";
import { assignmentKey, verifyAssignment } from "@/lib/experiments/contract";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const secret = process.env.HOMEPAGE_EXPERIMENT_SECRET || "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (
    env.SELF_HOSTED ||
    process.env.EXPERIMENT_INGEST_ENABLED !== "true" ||
    secret.length < 32 ||
    !timingSafeEqual(digest(request.headers.get("authorization") || ""), digest(`Bearer ${secret}`))
  )
    return new Response(null, { status: 403 });
  try {
    if (Number(request.headers.get("content-length")) > 1500) return new Response(null, { status: 413 });
    const text = await limitedBody(request, 1500);
    if (text === null) return new Response(null, { status: 413 });
    const body = JSON.parse(text);
    if (typeof body.token !== "string") return new Response(null, { status: 400 });
    const now = new Date();
    const assignment = verifyAssignment(body.token, secret, now.getTime());
    if (!assignment || now.getTime() >= assignment.enrollmentEndsAt) return new Response(null, { status: 400 });
    await prisma.experimentExposure.createMany({
      skipDuplicates: true,
      data: {
        id: assignmentKey(assignment),
        experimentId: assignment.experimentId,
        variant: assignment.variant,
        assignedAt: new Date(assignment.issuedAt),
        exposedAt: now,
      },
    });
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
