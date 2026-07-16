import { type NextRequest, NextResponse } from "next/server";

import { assertPlanFeature } from "@/lib/billing/subscriptions";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, handleApiError, NotFoundError } from "@/lib/utils/errors";

function serializeApiKey(apiKey: {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    active: !apiKey.revokedAt,
    lastUsedAt: apiKey.lastUsedAt,
    revokedAt: apiKey.revokedAt,
    createdAt: apiKey.createdAt,
    updatedAt: apiKey.updatedAt,
  };
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireBrowserSession(req);
    const { id } = await params;
    await assertPlanFeature(session.user.id, "apiAccess", { action: "revoke_api_key" });
    const apiKey = await prisma.apiKey.findUnique({ where: { id } });

    if (!apiKey) {
      throw new NotFoundError("API key not found");
    }

    if (apiKey.userId !== session.user.id) {
      throw new ForbiddenError("You don't have permission to modify this API key");
    }

    if (apiKey.revokedAt) {
      return NextResponse.json({ success: true, key: serializeApiKey(apiKey) });
    }

    const revokedKey = await prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    return NextResponse.json({ success: true, key: serializeApiKey(revokedKey) });
  } catch (error) {
    return handleApiError(error);
  }
}
