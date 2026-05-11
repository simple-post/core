import { type NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { requireBrowserSession } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { generateApiKey, getApiKeyPrefix, hashApiKey } from "@/lib/security/api-keys";
import { handleApiError } from "@/lib/utils/errors";

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
});

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

async function readJsonBody(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireBrowserSession(req);
    const apiKeys = await prisma.apiKey.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ keys: apiKeys.map((apiKey) => serializeApiKey(apiKey)) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireBrowserSession(req);
    const body = await readJsonBody(req);
    const validated = createApiKeySchema.parse(body);
    const apiKey = generateApiKey();

    const record = await prisma.apiKey.create({
      data: {
        userId: session.user.id,
        name: validated.name || "API Key",
        tokenHash: hashApiKey(apiKey),
        keyPrefix: getApiKeyPrefix(apiKey),
      },
    });

    return NextResponse.json({ apiKey, key: serializeApiKey(record) }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
