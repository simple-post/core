import { updateWorkspaceGrant } from "@/app/admin/team-workspaces/actions";
import { auth } from "@/lib/auth/auth";
import { hasVerifiedAdminAccess } from "@/lib/auth/verified-admin";
import { prisma } from "@/lib/prisma";

jest.mock("next/headers", () => ({ headers: async () => new Headers() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
  redirect: (path: string) => {
    throw new Error(path);
  },
}));
jest.mock("@/lib/auth/auth", () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock("@/lib/auth/verified-admin", () => ({ hasVerifiedAdminAccess: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: jest.fn() }, userFeature: { upsert: jest.fn(), deleteMany: jest.fn() } },
}));

beforeEach(() => {
  jest.resetAllMocks();
  (auth.api.getSession as unknown as jest.Mock).mockResolvedValue({ user: { id: "my-account" } });
  jest.mocked(hasVerifiedAdminAccess).mockResolvedValue(true);
});
function change(action: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ action, ...extra })) form.set(k, v);
  return updateWorkspaceGrant(form);
}
it.each(["grantSelf", "grantEmail", "revoke"])("only verified site admins can perform %s", async (action) => {
  jest.mocked(hasVerifiedAdminAccess).mockResolvedValue(false);
  await expect(change(action)).rejects.toThrow("not found");
  expect(prisma.userFeature.upsert).not.toHaveBeenCalled();
  expect(prisma.userFeature.deleteMany).not.toHaveBeenCalled();
});
it("self activation uses the administrator's session identity", async () => {
  await expect(change("grantSelf", { userId: "other", email: "other@example.test" })).rejects.toThrow(
    "?result=enabled",
  );
  expect(prisma.userFeature.upsert).toHaveBeenCalledWith({
    where: { userId_feature: { userId: "my-account", feature: "TEAM_WORKSPACES" } },
    create: { userId: "my-account", feature: "TEAM_WORKSPACES" },
    update: {},
  });
});
it("refuses unknown or unverified invitees", async () => {
  jest.mocked(prisma.user.findUnique).mockResolvedValue({ id: "other", emailVerified: false } as never);
  await expect(change("grantEmail", { email: "other@example.test" })).rejects.toThrow("?result=missing");
  expect(prisma.userFeature.upsert).not.toHaveBeenCalled();
});
it("revokes only this feature on the specified account", async () => {
  await expect(change("revoke", { userId: "other" })).rejects.toThrow("?result=revoked");
  expect(prisma.userFeature.deleteMany).toHaveBeenCalledWith({
    where: { userId: "other", feature: "TEAM_WORKSPACES" },
  });
});
