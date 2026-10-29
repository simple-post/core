import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { recordFunnelEvent } from "@/lib/analytics/events";
import { registerMeasuredTool } from "@/lib/mcp/registration";

import type { CallToolResult } from "@modelcontextprotocol/server";
jest.mock("@modelcontextprotocol/ext-apps/server", () => ({ registerAppTool: jest.fn() }));
jest.mock("@/lib/analytics/events", () => ({
  recordFunnelEvent: jest.fn(),
  measurementFailure: () => "unknown_error",
}));
beforeEach(() => jest.clearAllMocks());
it("forwards an object schema unchanged and preserves its typed callback result", async () => {
  const schema = z.object({ message: z.string() }),
    config = { inputSchema: schema, _meta: {} };
  const result: CallToolResult = { content: [{ type: "text", text: "HELLO" }] };
  registerMeasuredTool({ userId: "u" }, { registerTool: jest.fn() }, "preview", config, async (input) => {
    expect(input.message.toUpperCase()).toBe("HELLO");
    return result;
  });
  const call = jest.mocked(registerAppTool).mock.calls[0];
  expect(call[2]).toBe(config);
  const callback = call[3] as (input: { message: string }, ctx: never) => Promise<CallToolResult>;
  expect(await callback({ message: "hello" }, {} as never)).toBe(result);
  expect(recordFunnelEvent).toHaveBeenCalledTimes(1);
});
it("does not convert legacy raw shapes or move their validation outside the existing callback", () => {
  const shape = { message: z.string() },
    config = { inputSchema: shape, _meta: {} };
  registerMeasuredTool({ userId: "u" }, { registerTool: jest.fn() }, "legacy", config, async (input) => ({
    content: [{ type: "text", text: input.message.toUpperCase() }],
  }));
  expect(jest.mocked(registerAppTool).mock.calls[0][2]).toBe(config);
  expect(jest.mocked(registerAppTool).mock.calls[0][2].inputSchema).toBe(shape);
});

it.each([
  "create_post",
  "upload_media",
  "validate_post",
  "preview_post",
  "update_scheduled_post",
  "discard_scheduled_post",
  "get_tiktok_creator_info",
  "future_extension_write",
  "show_post_preview",
])("blocks %s before its handler can run after trial expiry", async (name) => {
  const handler = jest.fn().mockResolvedValue({ content: [] });
  registerMeasuredTool(
    { userId: "u", readOnly: true },
    { registerTool: jest.fn() },
    name,
    { inputSchema: z.object({}), _meta: {} },
    handler,
  );
  const callback = jest.mocked(registerAppTool).mock.calls[0][3] as (
    input: object,
    ctx: never,
  ) => Promise<CallToolResult>;
  const result = await callback({}, {} as never);
  expect(result.isError).toBe(true);
  expect(result._meta?.["simplepost/retryable"]).toBe(false);
  expect(handler).not.toHaveBeenCalled();
});

it.each(["list_accounts", "inspect_posts", "get_schedule", "show_schedule", "show_post_preview"])(
  "allows saved-data %s while retaining the original handler's ownership and scope checks",
  async (name) => {
    const handler = jest.fn().mockResolvedValue({ content: [] });
    registerMeasuredTool(
      { userId: "u", readOnly: true },
      { registerTool: jest.fn() },
      name,
      { inputSchema: z.object({ postId: z.string() }), _meta: {} },
      handler,
    );
    const callback = jest.mocked(registerAppTool).mock.calls[0][3] as (
      input: object,
      ctx: never,
    ) => Promise<CallToolResult>;
    await callback({ postId: "saved" }, {} as never);
    expect(handler).toHaveBeenCalledWith({ postId: "saved" }, {});
  },
);
