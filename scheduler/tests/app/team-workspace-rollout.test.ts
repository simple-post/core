import { NextRequest } from "next/server";

import { GET as download } from "@/app/api/v1/workspaces/[id]/files/[fileId]/route";
import { POST as upload } from "@/app/api/v1/workspaces/[id]/files/route";
import { GET as read, POST as command } from "@/app/api/v1/workspaces/[id]/route";
import { GET as list, POST as createOrAccept } from "@/app/api/v1/workspaces/route";
import { hasFeature } from "@/lib/features";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { listWorkspaces } from "@/lib/workspaces/access";

jest.mock("@/lib/middleware/auth", () => ({ requireBrowserSession: jest.fn() }));
jest.mock("@/lib/features", () => ({ hasFeature: jest.fn() }));
jest.mock("@/lib/workspaces/access", () => ({ listWorkspaces: jest.fn() }));

const req = new NextRequest("https://app.test/api/v1/workspaces?userId=someone-else");
const ctx = { params: Promise.resolve({ id: "workspace", fileId: "file" }) };

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(requireBrowserSession).mockResolvedValue({ user: { id: "signed-in" } } as never);
});

it.each([
  ["workspace index", () => list(req)],
  ["creation and invite acceptance", () => createOrAccept(req)],
  ["workspace detail", () => read(req, ctx)],
  ["workspace commands and release", () => command(req, ctx)],
  ["upload", () => upload(req, ctx)],
  ["download", () => download(req, ctx)],
])("checks the signed-in account before serving %s", async (_name, run) => {
  jest.mocked(hasFeature).mockResolvedValue(false);
  const response = await run();
  expect(response.status).toBe(404);
  expect(hasFeature).toHaveBeenCalledWith("signed-in", "TEAM_WORKSPACES");
  expect(listWorkspaces).not.toHaveBeenCalled();
});

it("revocation cuts off the same signed-in session on its next request", async () => {
  jest.mocked(hasFeature).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  jest.mocked(listWorkspaces).mockResolvedValue({ workspaces: [], invites: [], owned: 0, limit: 0 });
  const enabled = await list(req);
  const revoked = await list(req);
  expect(enabled.status).toBe(200);
  expect(revoked.status).toBe(404);
  expect(listWorkspaces).toHaveBeenCalledTimes(1);
});
