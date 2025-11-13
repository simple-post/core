import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);

    // Fetch user's connected social media accounts (for posting)
    const connectedAccounts = await prisma.connectedAccount.findMany({
      where: {
        userId: session.user.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({ accounts: connectedAccounts });
  } catch (error) {
    return handleApiError(error);
  }
}
