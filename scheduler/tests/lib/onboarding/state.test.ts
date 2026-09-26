jest.mock("@/lib/prisma", () => ({
  prisma: {
    connectedAccount: { count: jest.fn() },
    post: { count: jest.fn() },
    mcpAccessToken: { count: jest.fn() },
    cliToken: { count: jest.fn() },
    apiKey: { count: jest.fn() },
  },
}));
import { getOnboardingState } from "@/lib/onboarding/state";
import { prisma } from "@/lib/prisma";
beforeEach(() => {
  jest.clearAllMocks();
  for (const model of [prisma.connectedAccount, prisma.post, prisma.mcpAccessToken, prisma.cliToken, prisma.apiKey])
    (model.count as jest.Mock).mockResolvedValue(0);
});
it("keeps assistant-only users at the account connection step", async () => {
  (prisma.mcpAccessToken.count as jest.Mock).mockResolvedValue(1);
  expect(await getOnboardingState("user")).toEqual({
    hasConnectedAccount: false,
    hasPost: false,
    hasPublishedPost: false,
    hasAiConnection: true,
  });
});
it("only counts scheduled/published posts as preparation and published posts as success", async () => {
  (prisma.post.count as jest.Mock).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
  const state = await getOnboardingState("user");
  expect(state.hasPost).toBe(true);
  expect(state.hasPublishedPost).toBe(false);
  expect(prisma.post.count).toHaveBeenNthCalledWith(1, {
    where: { userId: "user", status: { in: ["scheduled", "published"] } },
    take: 1,
  });
  expect(prisma.post.count).toHaveBeenNthCalledWith(2, { where: { userId: "user", status: "published" }, take: 1 });
});
it("completes the publishing milestone only after success", async () => {
  (prisma.post.count as jest.Mock).mockResolvedValue(1);
  const state = await getOnboardingState("user");
  expect(state.hasPublishedPost).toBe(true);
});
