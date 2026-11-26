import { handleFacebookCallback } from "@/lib/oauth/callbacks/facebook";
import type { CallbackContext } from "@/lib/oauth/types";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    connectedAccount: { findFirst: jest.fn() },
    pendingOAuthConnection: { create: jest.fn(), deleteMany: jest.fn() },
  },
}));

const context: CallbackContext = {
  userId: "fixture-user",
  platform: "facebook",
  baseURL: "https://simplepost.example",
  accessToken: "fixture-token",
  tokenData: {},
  refreshToken: null,
  expiresIn: undefined,
  scope: undefined,
  tokenMetadata: null,
  workspaceId: "fixture-workspace",
  reconnectAccountId: "fixture-account",
};

beforeEach(() => jest.resetAllMocks());
afterEach(() => jest.restoreAllMocks());

it("rejects Facebook reconnect when the grant excludes the existing Page", async () => {
  jest
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      Response.json({ data: [{ id: "other-page", name: "Other", access_token: "fixture-page-token" }] }),
    );
  jest.mocked(prisma.connectedAccount.findFirst).mockResolvedValue({ platformAccountId: "expected-page" } as never);

  await expect(handleFacebookCallback(context)).rejects.toMatchObject({ code: "reconnect_account_mismatch" });
  expect(prisma.connectedAccount.findFirst).toHaveBeenCalledWith({
    where: { id: "fixture-account", userId: "fixture-user", workspaceId: "fixture-workspace", platform: "facebook" },
    select: { platformAccountId: true },
  });
  expect(prisma.pendingOAuthConnection.create).not.toHaveBeenCalled();
});
