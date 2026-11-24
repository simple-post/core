import { type NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";
import { authorize, membership } from "@/lib/workspaces/access";
import { maxFileSize } from "@/lib/workspaces/contracts";
import { saveFile } from "@/lib/workspaces/files";
import { requireTeamWorkspaceSession } from "@/lib/workspaces/session";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireTeamWorkspaceSession(req);
    const { id } = await params;
    authorize(await membership(prisma, id, user.id), "edit");
    const reader = req.body?.getReader();
    if (!reader) throw new BadRequestError("Choose a file");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxFileSize) {
        await reader.cancel();
        throw new BadRequestError("Files must be 8 MiB or smaller");
      }
      chunks.push(value);
    }
    return NextResponse.json(
      await saveFile(user, id, req.nextUrl.searchParams.get("name") || "media", Buffer.concat(chunks)),
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
