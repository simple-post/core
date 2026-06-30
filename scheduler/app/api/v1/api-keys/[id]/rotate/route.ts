import { type NextRequest, NextResponse } from "next/server";

import { assertPlanFeature } from "@/lib/billing/subscriptions";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { generateApiKey, getApiKeyPrefix, hashApiKey } from "@/lib/security/api-keys";
import { BadRequestError, ForbiddenError, handleApiError, NotFoundError } from "@/lib/utils/errors";

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireBrowserSession(req);
    await assertPlanFeature(session.user.id, "apiAccess");
    const { id } = await params;
    const currentKey = await prisma.apiKey.findUnique({ where: { id } });

    if (!currentKey) {
      throw new NotFoundError("API key not found");
    }

    if (currentKey.userId !== session.user.id) {
      throw new ForbiddenError("You don't have permission to modify this API key");
    }

    if (currentKey.revokedAt) {
      throw new BadRequestError("Only active API keys can be rotated");
    }

    const apiKey = generateApiKey();
    const nextKey = await prisma.$transaction(async (tx) => {
      await tx.apiKey.update({
        where: { id },
        data: { revokedAt: new Date() },
      });

      return tx.apiKey.create({
        data: {
          userId: session.user.id,
          name: currentKey.name,
          tokenHash: hashApiKey(apiKey),
          keyPrefix: getApiKeyPrefix(apiKey),
        },
      });
    });

    return NextResponse.json({ apiKey, key: serializeApiKey(nextKey), rotatedFromId: currentKey.id }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
