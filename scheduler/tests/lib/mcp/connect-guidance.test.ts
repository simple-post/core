import { PostsModel } from "@/lib/db";
import {
  formatConnectAccountsGuidance,
  getConnectAccountsUrl,
  NO_CONNECTED_ACCOUNTS_CODE,
} from "@/lib/mcp/connect-guidance";
import { McpToolError } from "@/lib/mcp/tool-errors";
import { resolveMcpAccountOptions } from "@/lib/mcp/tools/account-options";
import { listAccounts } from "@/lib/mcp/tools/accounts";
import { inspectPosts, inspectPostsOutputSchema } from "@/lib/mcp/tools/posts";
import { getSchedule, showScheduleOutputSchema } from "@/lib/mcp/tools/schedule";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({ prisma: { connectedAccount: { count: jest.fn(), findMany: jest.fn() } } }));
jest.mock("@/lib/db", () => ({ PostsModel: jest.fn() }));
jest.mock("@/lib/posting-slots/settings", () => ({ getUserPostingSlots: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/mcp/tools/accounts", () => ({
  ...jest.requireActual("@/lib/mcp/tools/accounts"),
  listAccounts: jest.fn(),
}));

const APP_URL = "https://simplepost.example";
const CONNECT_URL = `${APP_URL}/accounts?onboarding=connect`;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;
  jest.mocked(prisma.connectedAccount.findMany).mockResolvedValue([]);
  jest.mocked(prisma.connectedAccount.count).mockResolvedValue(0);
});

it("builds the link from the runtime app URL as clickable Markdown", () => {
  expect(getConnectAccountsUrl()).toBe(CONNECT_URL);
  expect(formatConnectAccountsGuidance()).toContain(`[Connect a social account](${CONNECT_URL})`);
  expect(formatConnectAccountsGuidance()).not.toContain("app.simplepost.social");
});

describe("account resolution ahead of media import", () => {
  it("stops a user with no account at all before anything is downloaded", async () => {
    const attempt = resolveMcpAccountOptions("user", ["stale-id"]);
    await expect(attempt).rejects.toBeInstanceOf(McpToolError);
    await expect(attempt).rejects.toMatchObject({
      code: NO_CONNECTED_ACCOUNTS_CODE,
      recovery: "stop",
      maxAutomaticRetries: 0,
      message: expect.stringContaining(`[Connect a social account](${CONNECT_URL})`),
    });
    expect(prisma.connectedAccount.count).toHaveBeenCalledWith({ where: { userId: "user" }, take: 1 });
  });

  it("leaves wrong IDs to the usual missing-account error when the user has accounts", async () => {
    jest.mocked(prisma.connectedAccount.count).mockResolvedValue(1);
    await expect(resolveMcpAccountOptions("user", ["stale-id"])).resolves.toBeUndefined();
  });

  it("costs no extra query when the requested accounts exist", async () => {
    jest.mocked(prisma.connectedAccount.findMany).mockResolvedValue([{ id: "x-1", platform: "x" }] as never);
    await resolveMcpAccountOptions("user", ["x-1"]);
    expect(prisma.connectedAccount.count).not.toHaveBeenCalled();
  });
});

it("flags a schedule with no destination even when earlier posts remain on it", async () => {
  jest.mocked(PostsModel).mockImplementation(
    () =>
      ({
        getPostsBetween: async () => [
          {
            id: "post-1",
            message: "Left behind after disconnecting",
            status: "scheduled",
            scheduledFor: new Date("2099-01-05T10:00:00Z"),
            accountIds: ["gone"],
            errorMessage: null,
          },
        ],
      }) as never,
  );

  const result = await getSchedule("user", { view: "day", date: "2099-01-05", timeZone: "UTC" });

  expect(showScheduleOutputSchema.safeParse(result).success).toBe(true);
  expect(result.connectAccountsUrl).toBe(CONNECT_URL);
  expect(result.days[0].entries).toEqual([expect.objectContaining({ postId: "post-1", platforms: [] })]);

  jest.mocked(prisma.connectedAccount.count).mockResolvedValue(1);
  const connected = await getSchedule("user", { view: "day", date: "2099-01-05", timeZone: "UTC" });
  expect(connected.connectAccountsUrl).toBeUndefined();
});

it("flags an empty post listing only while no account is connected", async () => {
  jest
    .mocked(PostsModel)
    .mockImplementation(() => ({ getDraftPosts: async () => ({ data: [], pagination: null }) }) as never);
  jest.mocked(listAccounts).mockResolvedValue({ accounts: [] } as never);

  const result = await inspectPosts("user", { status: "drafts", page: 1, limit: 10 });
  expect(inspectPostsOutputSchema.safeParse(result).success).toBe(true);
  expect(result.connectAccountsUrl).toBe(CONNECT_URL);

  jest.mocked(listAccounts).mockResolvedValue({ accounts: [{ accountId: "x-1", platform: "x" }] } as never);
  const connected = await inspectPosts("user", { status: "drafts", page: 1, limit: 10 });
  expect(connected.connectAccountsUrl).toBeUndefined();
});
