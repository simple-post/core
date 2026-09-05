import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { reconciliationSchema, reconcilePublish } from "@/lib/posting/reconciliation";
import { prisma } from "@/lib/prisma";
import { handleApiError, NotFoundError } from "@/lib/utils/errors";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Context) {
  try {
    const session = await requireAuth(req);
    const { id } = await params;
    const post = await prisma.post.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
    if (!post) throw new NotFoundError("Post not found");
    const checkpoints = await prisma.publishCheckpoint.findMany({
      where: { postId: id },
      select: { accountId: true, operation: true, segment: true, state: true, updatedAt: true, result: true },
      orderBy: [{ accountId: "asc" }, { segment: "asc" }],
    });
    return NextResponse.json({ checkpoints });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: Context) {
  try {
    const session = await requireAuth(req);
    const { id } = await params;
    await reconcilePublish(session.user.id, id, reconciliationSchema.parse(await req.json()));
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
