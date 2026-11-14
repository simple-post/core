import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { recordFunnelEvent } from "@/lib/analytics/events";
import { registerMeasuredTool } from "@/lib/mcp/registration";

import type { CallToolResult, StandardSchemaWithJSON } from "@modelcontextprotocol/server";
jest.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: jest.fn(async () => ({ pluginLocale: null })) } } }));
jest.mock("@modelcontextprotocol/ext-apps/server", () => ({ registerAppTool: jest.fn() }));
jest.mock("@/lib/analytics/events", () => ({
  recordFunnelEvent: jest.fn(),
  measurementFailure: () => "unknown_error",
}));
beforeEach(() => jest.clearAllMocks());
it("preserves object-schema validation and its typed callback result", async () => {
  const schema = z.object({ message: z.string() }),
    config = { inputSchema: schema, _meta: {} };
  const result: CallToolResult = { content: [{ type: "text", text: "HELLO" }] };
  registerMeasuredTool({ userId: "u" }, { registerTool: jest.fn() }, "preview", config, async (input) => {
    expect(input.message.toUpperCase()).toBe("HELLO");
    return result;
  });
  const call = jest.mocked(registerAppTool).mock.calls[0];
  expect(call[2]._meta).toBe(config._meta);
  const registered = call[2].inputSchema as StandardSchemaWithJSON;
  expect(await registered["~standard"].validate({ message: "hello" })).toEqual({ value: { message: "hello" } });
  const invalid = await registered["~standard"].validate({ message: 42 });
  expect(invalid.issues).toBeDefined();
  const callback = call[3] as (input: { message: string }, ctx: never) => Promise<CallToolResult>;
  const enriched = await callback({ message: "hello" }, {} as never);
  expect(enriched.content[0]).toEqual(result.content[0]);
  expect(enriched.content.at(-1)).toEqual({ type: "text", text: JSON.stringify({ resolvedLocale: "en" }) });
  expect(recordFunnelEvent).toHaveBeenCalledTimes(1);
});
it("preserves legacy raw-shape validation and strips the same unknown fields", async () => {
  const shape = { message: z.string() },
    config = { inputSchema: shape, _meta: {} };
  registerMeasuredTool({ userId: "u" }, { registerTool: jest.fn() }, "legacy", config, async (input) => ({
    content: [{ type: "text", text: input.message.toUpperCase() }],
  }));
  const registered = jest.mocked(registerAppTool).mock.calls[0][2].inputSchema as StandardSchemaWithJSON;
  expect(await registered["~standard"].validate({ message: "unchanged", other: true })).toEqual({
    value: { message: "unchanged" },
  });
  const invalid = await registered["~standard"].validate({ message: false });
  expect(invalid.issues).toBeDefined();
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

it("localizes only the user-facing billing message from request metadata", async () => {
  registerMeasuredTool(
    { userId: "u", readOnly: true },
    { registerTool: jest.fn() },
    "create_post",
    { inputSchema: z.object({}), _meta: {} },
    jest.fn(),
  );
  const callback = jest.mocked(registerAppTool).mock.calls[0][3] as (
    input: object,
    ctx: object,
  ) => Promise<CallToolResult>;
  const [japanese, arabic] = await Promise.all([
    callback({}, { mcpReq: { _meta: { "openai/locale": "ja-JP" } } }),
    callback({}, { mcpReq: { _meta: { "openai/locale": "ar" } } }),
  ]);
  expect(japanese.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("試用期間") });
  expect(arabic.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("انتهت فترتك التجريبية") });
  expect(japanese._meta?.["simplepost/error"]).toMatchObject({ message: expect.stringContaining("Your trial") });
  expect(arabic._meta?.["simplepost/retryable"]).toBe(false);
});
