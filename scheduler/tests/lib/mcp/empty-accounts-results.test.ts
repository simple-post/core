import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";

import { noConnectedAccountsError } from "@/lib/mcp/connect-guidance";
import { registerTools, SERVER_INSTRUCTIONS } from "@/lib/mcp/server";
import { listAccounts } from "@/lib/mcp/tools/accounts";
import { createPost, inspectPosts } from "@/lib/mcp/tools/posts";
import { getSchedule } from "@/lib/mcp/tools/schedule";

jest.mock("@modelcontextprotocol/ext-apps/server", () => ({ registerAppTool: jest.fn() }));
jest.mock("@/lib/mcp/ui/resources", () => ({ registerMcpUiResources: jest.fn() }));
jest.mock("@/lib/mcp/tools/accounts", () => ({
  ...jest.requireActual("@/lib/mcp/tools/accounts"),
  listAccounts: jest.fn(),
}));
jest.mock("@/lib/mcp/tools/schedule", () => ({
  ...jest.requireActual("@/lib/mcp/tools/schedule"),
  getSchedule: jest.fn(),
}));
jest.mock("@/lib/mcp/tools/posts", () => ({
  ...jest.requireActual("@/lib/mcp/tools/posts"),
  createPost: jest.fn(),
  inspectPosts: jest.fn(),
}));

type ToolResult = {
  content: Array<{ text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};
type ToolHandler = (...args: never[]) => Promise<ToolResult>;

const CONNECT_URL = "https://simplepost.example/accounts?onboarding=connect";
const LINK = `[Connect a social account](${CONNECT_URL})`;

function handler(name: string): (input?: Record<string, unknown>) => Promise<ToolResult> {
  jest.mocked(registerAppTool).mockClear();
  registerTools(new McpServer({ name: "test", version: "1" }), { userId: "user", scope: null });
  const registered = jest.mocked(registerAppTool).mock.calls.find((call) => call[1] === name)![3] as ToolHandler;
  // The registered callback also receives a server context the text output never reads.
  return (input = {}) => (registered as (...args: unknown[]) => Promise<ToolResult>)(input, {});
}

const schedule = {
  kind: "schedule" as const,
  view: "day" as const,
  anchorDate: "2099-01-05",
  previousAnchorDate: "2099-01-04",
  nextAnchorDate: "2099-01-06",
  todayAnchorDate: "2099-01-05",
  timeZone: "UTC",
  periodLabel: "Tuesday, January 5, 2099",
  rangeStart: "2099-01-05T00:00:00.000Z",
  rangeEnd: "2099-01-06T00:00:00.000Z",
  days: [],
  summary: { openSlotCount: 0, scheduledCount: 1, publishedCount: 0, failedCount: 0, pastCount: 0 },
};

const noPosts = {
  kind: "posts" as const,
  status: "drafts" as const,
  posts: [],
  pagination: null,
  summary: { totalReturned: 0, draftCount: 0, scheduledCount: 0, postedCount: 0, failedCount: 0 },
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://simplepost.example";
});

it("no longer hardcodes the hosted app in the server instructions", () => {
  expect(SERVER_INSTRUCTIONS).not.toContain("https://app.simplepost.social");
  expect(SERVER_INSTRUCTIONS).toContain("connectAccountsUrl");
});

it("answers an empty account list with the connect link and no starter prompt", async () => {
  jest.mocked(listAccounts).mockResolvedValue({
    kind: "accounts",
    connectionLinks: [],
    accounts: [],
    summary: { total: 0, platforms: [] },
    connectAccountsUrl: CONNECT_URL,
  });
  const result = await handler("list_accounts")();
  expect(result.content[0].text).toContain(LINK);
  expect(result.content[0].text).toContain("return to this conversation");
  expect(result.content[0].text).not.toMatch(/first draft|prompt/i);
  expect(result.structuredContent).toMatchObject({ connectAccountsUrl: CONNECT_URL });
});

it.each(["get_schedule", "show_schedule"])("%s keeps the calendar and adds the link", async (name) => {
  jest.mocked(getSchedule).mockResolvedValue({ ...schedule, connectAccountsUrl: CONNECT_URL });
  const flagged = await handler(name)({ view: "day", timeZone: "UTC" });
  expect(flagged.content[0].text).toContain("1 scheduled");
  expect(flagged.content[0].text).toContain(LINK);

  jest.mocked(getSchedule).mockResolvedValue(schedule);
  const connected = await handler(name)({ view: "day", timeZone: "UTC" });
  expect(connected.content[0].text).not.toContain("Connect a social account");
});

it("guides an empty post listing to connect, but not a single-post lookup", async () => {
  jest.mocked(inspectPosts).mockResolvedValue({ ...noPosts, connectAccountsUrl: CONNECT_URL } as never);
  const listing = await handler("inspect_posts")({ status: "drafts" });
  expect(listing.content[0].text).toContain("No posts matched");
  expect(listing.content[0].text).toContain(LINK);

  jest
    .mocked(inspectPosts)
    .mockResolvedValue({ ...noPosts, status: "single", connectAccountsUrl: CONNECT_URL } as never);
  const single = await handler("inspect_posts")({ postId: "missing" });
  expect(single.content[0].text).not.toContain("Connect a social account");
});

it("returns a terminal, non-retryable error with the link when posting without any account", async () => {
  jest.mocked(createPost).mockRejectedValue(noConnectedAccountsError());
  const result = await handler("create_post")({ message: "Hello", accountIds: ["stale"], postingMode: "draft" });

  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain(LINK);
  const diagnostic = JSON.parse(result.content[0].text.split("SIMPLEPOST_ERROR ")[1]);
  expect(diagnostic).toMatchObject({ code: "NO_CONNECTED_ACCOUNTS", recovery: "stop", maxAutomaticRetries: 0 });
  expect(result._meta).toMatchObject({ "simplepost/retryable": false });
});
