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
