import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError, NotFoundError, ForbiddenError } from "@/lib/utils/errors";
import { prisma } from "@/lib/prisma";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(request);

    // Check if the account exists and belongs to the user
    const account = await prisma.connectedAccount.findUnique({
      where: { id },
    });

    if (!account) {
      throw new NotFoundError("Account not found");
    }

    if (account.userId !== session.user.id) {
      throw new ForbiddenError("You don't have permission to delete this account");
    }

    // Delete the account
    await prisma.connectedAccount.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, message: "Account disconnected successfully" });
  } catch (error) {
    return handleApiError(error);
  }
}
