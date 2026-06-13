import crypto from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { requireAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError, BadRequestError } from "@/lib/utils/errors";
import { assertValidWebhookUrl, WEBHOOK_EVENTS } from "@/lib/webhooks";

const createWebhookSchema = z.object({
  url: z.string().min(1),
  events: z
    .array(z.enum(WEBHOOK_EVENTS))
    .min(1)
    .default([...WEBHOOK_EVENTS]),
});

const MAX_ENDPOINTS_PER_USER = 10;

function toPublicWebhook(endpoint: {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}) {
  return {
    id: endpoint.id,
    url: endpoint.url,
    events: endpoint.events,
    active: endpoint.active,
    lastSuccessAt: endpoint.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: endpoint.lastFailureAt?.toISOString() ?? null,
    lastError: endpoint.lastError,
    createdAt: endpoint.createdAt.toISOString(),
  };
}

// GET /api/v1/webhooks - List webhook endpoints (without secrets)
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ webhooks: endpoints.map((endpoint) => toPublicWebhook(endpoint)) });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/v1/webhooks - Create a webhook endpoint. The signing secret is
// returned once in this response and never again.
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const body = createWebhookSchema.parse(await req.json());

    try {
      assertValidWebhookUrl(body.url);
    } catch (error) {
      throw new BadRequestError(error instanceof Error ? error.message : "Invalid webhook URL");
    }

    const existing = await prisma.webhookEndpoint.count({ where: { userId: session.user.id } });
    if (existing >= MAX_ENDPOINTS_PER_USER) {
      throw new BadRequestError(`You can register at most ${MAX_ENDPOINTS_PER_USER} webhook endpoints.`);
    }

    const secret = `whsec_${crypto.randomBytes(32).toString("base64url")}`;
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        userId: session.user.id,
        url: body.url,
        events: body.events,
        secret,
      },
    });

    return NextResponse.json({ webhook: { ...toPublicWebhook(endpoint), secret } }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
