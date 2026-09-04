import { resolveMcpAccountOptions } from "@/lib/mcp/tools/account-options";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({ prisma: { connectedAccount: { findMany: jest.fn() } } }));

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.connectedAccount.findMany as jest.Mock).mockResolvedValue([
    { id: "tiktok-1", platform: "TikTok" },
    { id: "tiktok-2", platform: "tiktok" },
    { id: "youtube-1", platform: "youtube" },
  ]);
});

it("defaults only owned TikTok targets and preserves other settings without mutating input", async () => {
  const options = { "tiktok-1": { allowComment: true }, "youtube-1": { privacyStatus: "private" } };
  const result = await resolveMcpAccountOptions("user-1", ["tiktok-1", "tiktok-2", "youtube-1"], options);
  expect(prisma.connectedAccount.findMany).toHaveBeenCalledWith({
    where: { userId: "user-1", id: { in: ["tiktok-1", "tiktok-2", "youtube-1"] } },
    select: { id: true, platform: true },
  });
  expect(result).toEqual({
    "tiktok-1": { allowComment: true, privacyLevel: "PUBLIC_TO_EVERYONE" },
    "tiktok-2": { privacyLevel: "PUBLIC_TO_EVERYONE" },
    "youtube-1": { privacyStatus: "private" },
  });
  expect(options["tiktok-1"]).toEqual({ allowComment: true });
});

it.each([
  { privacyLevel: "PUBLIC_TO_EVERYONE" },
  { privacyLevel: "SELF_ONLY" },
  { privacyLevel: "MUTUAL_FOLLOW_FRIENDS" },
  { privacyLevel: "FOLLOWER_OF_CREATOR" },
  { visibility: "private" },
  { visibility: "friends" },
  { publishMode: "draft" },
  { privacyLevel: "invalid" },
])("does not overwrite an explicit audience or inbox selection: %j", async (selected) => {
  const result = await resolveMcpAccountOptions("user-1", ["tiktok-1"], { "tiktok-1": selected });
  expect(result?.["tiktok-1"]).toEqual(selected);
});

it("does not create defaults for unknown accounts or other platforms", async () => {
  (prisma.connectedAccount.findMany as jest.Mock).mockResolvedValue([{ id: "youtube-1", platform: "youtube" }]);
  expect(await resolveMcpAccountOptions("user-1", ["unknown", "youtube-1"])).toBeUndefined();
});
