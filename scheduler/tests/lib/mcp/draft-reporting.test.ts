import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";

import { registerTools } from "@/lib/mcp/server";
import { createPost } from "@/lib/mcp/tools/posts";

jest.mock("@modelcontextprotocol/ext-apps/server", () => ({ registerAppTool: jest.fn() }));
jest.mock("@/lib/mcp/ui/resources", () => ({ registerMcpUiResources: jest.fn() }));
jest.mock("@/lib/mcp/tools/posts", () => ({
  ...jest.requireActual("@/lib/mcp/tools/posts"),
  createPost: jest.fn(),
}));

type ToolHandler = (...args: never[]) => Promise<{ content: Array<{ text: string }> }>;

function createPostHandler(): (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> {
  jest.mocked(registerAppTool).mockClear();
  registerTools(new McpServer({ name: "test", version: "1" }), { userId: "user", scope: null });
  const handler = jest.mocked(registerAppTool).mock.calls.find((call) => call[1] === "create_post")![3] as ToolHandler;
  // The registered callback also receives a server context the text output never reads.
  return (input) => (handler as (...args: unknown[]) => ReturnType<ToolHandler>)(input, {});
}

type Issue = { code: string; severity: "error" | "warning"; message: string };

const account = {
  accountId: "ig-1",
  platform: "instagram",
  username: "studio",
  displayName: "Studio",
  profilePicture: null,
};

function result(overrides: {
  status: string;
  postingMode: "now" | "schedule" | "draft";
  errors?: Issue[];
  warnings?: Issue[];
}) {
  const errors = overrides.errors ?? [];
  const warnings = overrides.warnings ?? [];
  return {
    kind: "post" as const,
    message: "Launch day",
    postingMode: overrides.postingMode,
    mediaCount: 0,
    post: {
      id: "post-1",
      message: "Launch day",
      accountIds: ["ig-1"],
      accountOptions: {},
      scheduledFor: overrides.postingMode === "schedule" ? "2099-01-01T10:00:00Z" : null,
      status: overrides.status,
      publishedAt: null,
      repostEnabled: false,
      repostDelayHours: 12,
      repostDueAt: null,
      repostStatus: "not_applicable",
      quotePostId: null,
    },
    validation: {
      kind: "validation" as const,
      message: "Launch day",
      mediaCount: 0,
      isValid: errors.length === 0,
      platforms: ["instagram"],
      accounts: [{ ...account, isValid: errors.length === 0, errors, warnings }],
      summary: { accountCount: 1, mediaCount: 0, errorCount: errors.length, warningCount: warnings.length },
    },
    postingResults: [],
    summary: {
      accountCount: 1,
      mediaCount: 0,
      threadSegmentCount: 0,
      successCount: 0,
      failureCount: 0,
      scheduledCount: overrides.postingMode === "schedule" ? 1 : 0,
      draftCount: overrides.postingMode === "draft" ? 1 : 0,
      overallSuccess: true,
    },
  };
}

const input = { message: "Launch day", accountIds: ["ig-1"], postingMode: "draft" };

it("tells the user a saved draft cannot be published, and why", async () => {
  jest
    .mocked(createPost)
    .mockResolvedValue(
      result({
        status: "draft",
        postingMode: "draft",
        errors: [{ code: "media_required", severity: "error", message: "Instagram requires an image or video." }],
      }),
    );

  const { content } = await createPostHandler()(input);

  expect(content[0].text).toContain("Saved the post as a draft");
  expect(content[0].text).toContain("can't be published as it stands — 1 problem to fix first");
  expect(content[0].text).toContain("Instagram requires an image or video.");
});

it("does not warn about publishing when a saved draft is clean", async () => {
  jest.mocked(createPost).mockResolvedValue(result({ status: "draft", postingMode: "draft" }));

  const { content } = await createPostHandler()(input);

  expect(content[0].text).toContain("Saved the post as a draft");
  expect(content[0].text).not.toContain("can't be published");
  // A clean draft makes no readiness claim: credential checks are skipped for drafts.
  expect(content[0].text).not.toContain("Validation:");
});

it("surfaces warnings that never block, on a scheduled post", async () => {
  jest.mocked(createPost).mockResolvedValue(
    result({
      status: "scheduled",
      postingMode: "schedule",
      warnings: [
        {
          code: "thread_not_supported",
          severity: "warning",
          message: "Instagram doesn't support threads, so only the first post will be published there.",
        },
      ],
    }),
  );

  const { content } = await createPostHandler()({ ...input, postingMode: "schedule" });

  expect(content[0].text).toContain("Validation: 0 errors, 1 warning.");
  expect(content[0].text).toContain("only the first post will be published there");
});
