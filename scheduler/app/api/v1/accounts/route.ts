import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);

    // Fetch user's connected social media accounts (for posting)
    const connectedAccounts = await prisma.connectedAccount.findMany({
      where: {
        userId: session.user.id,
      },
      select: {
        id: true,
        userId: true,
        platform: true,
        platformAccountId: true,
        tokenType: true,
        expiresAt: true,
        scope: true,
        username: true,
        displayName: true,
        email: true,
        profilePicture: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(
      { accounts: connectedAccounts },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
