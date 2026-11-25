import type { NextRequest } from "next/server";

import { hasFeature } from "@/lib/features";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { NotFoundError } from "@/lib/utils/errors";

export async function requireTeamWorkspaceSession(req: NextRequest) {
  const session = await requireBrowserSession(req);
  if (!(await hasFeature(session.user.id, "TEAM_WORKSPACES"))) throw new NotFoundError();
  return session;
}
