import { type NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { requireAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError, BadRequestError, NotFoundError } from "@/lib/utils/errors";
import { assertValidWebhookUrl, WEBHOOK_EVENTS } from "@/lib/webhooks";

const updateWebhookSchema = z.object({
  url: z.string().min(1).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  active: z.boolean().optional(),
});

// PATCH /api/v1/webhooks/[id] - Update url, events, or active state
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(req);
    const body = updateWebhookSchema.parse(await req.json());

    if (body.url) {
      try {
        assertValidWebhookUrl(body.url);
      } catch (error) {
        throw new BadRequestError(error instanceof Error ? error.message : "Invalid webhook URL");
      }
    }

    const { count } = await prisma.webhookEndpoint.updateMany({
      where: { id, userId: session.user.id },
      data: {
        ...(body.url === undefined ? {} : { url: body.url }),
        ...(body.events === undefined ? {} : { events: body.events }),
        ...(body.active === undefined ? {} : { active: body.active }),
      },
    });

    if (count === 0) {
      throw new NotFoundError("Webhook endpoint not found");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/v1/webhooks/[id] - Remove a webhook endpoint
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(req);

    const { count } = await prisma.webhookEndpoint.deleteMany({
      where: { id, userId: session.user.id },
    });

    if (count === 0) {
      throw new NotFoundError("Webhook endpoint not found");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
