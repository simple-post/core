import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError, NotFoundError, ForbiddenError, BadRequestError } from "@/lib/utils/errors";

interface PinterestBoard {
  id: string;
  name: string;
  description?: string;
  pin_count?: number;
  privacy?: string;
}

interface PinterestBoardsResponse {
  items: PinterestBoard[];
  bookmark?: string;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(request);

    // Fetch the account
    const account = await prisma.connectedAccount.findUnique({
      where: { id },
    });

    if (!account) {
      throw new NotFoundError("Account not found");
    }

    if (account.userId !== session.user.id) {
      throw new ForbiddenError("You don't have permission to access this account");
    }

    if (account.platform.toLowerCase() !== "pinterest") {
      throw new BadRequestError("This endpoint only supports Pinterest accounts");
    }

    // Fetch boards from Pinterest API
    const response = await fetch("https://api.pinterest.com/v5/boards?page_size=100", {
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new BadRequestError(
        `Failed to fetch Pinterest boards: ${(error as { message?: string }).message || response.statusText}`,
      );
    }

    const data = (await response.json()) as PinterestBoardsResponse;

    // Return simplified board list
    const boards = data.items.map((board) => ({
      id: board.id,
      name: board.name,
      description: board.description || null,
      pinCount: board.pin_count || 0,
    }));

    return NextResponse.json({ boards });
  } catch (error) {
    return handleApiError(error);
  }
}
