import { type NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/utils/errors";
import { readWorkspace } from "@/lib/workspaces/access";
import { commandSchema } from "@/lib/workspaces/contracts";
import { deliverWorkspaceInvitation } from "@/lib/workspaces/invitations";
import { runCommand } from "@/lib/workspaces/posts";
import { cancelDelivery, release } from "@/lib/workspaces/release";
import { requireTeamWorkspaceSession } from "@/lib/workspaces/session";

type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, { params }: Context) {
  try {
    const { user } = await requireTeamWorkspaceSession(req);
    const { id } = await params;
    return NextResponse.json(await readWorkspace(user, id));
  } catch (error) {
    return handleApiError(error, req);
  }
}
export async function POST(req: NextRequest, { params }: Context) {
  try {
    const { user } = await requireTeamWorkspaceSession(req);
    const { id } = await params;
    const cmd = commandSchema.parse(await req.json());
    const result =
      cmd.action === "release"
        ? await release(user, id, cmd.postId, cmd.reviewId)
        : cmd.action === "cancelDelivery"
          ? await cancelDelivery(user, id, cmd.postId, cmd.deliveryId)
          : await runCommand(user, id, cmd);
    const resultId = result && "id" in result ? result.id : null;
    if (resultId && (cmd.action === "invite" || cmd.action === "resendInvite")) {
      return NextResponse.json({ id: resultId, invitationEmailSent: await deliverWorkspaceInvitation(resultId) });
    }
    return NextResponse.json({ id: resultId });
  } catch (error) {
    return handleApiError(error, req);
  }
}
