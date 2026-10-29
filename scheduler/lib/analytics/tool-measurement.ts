import { measurementFailure, recordFunnelEvent } from "./events";

import type { CallToolResult, InputRequiredResult } from "@modelcontextprotocol/server";

/** One observation per completed invocation; inputs and results are never retained. */
export async function measureMcpTool(
  context: { userId: string },
  tool: string,
  run: () => Promise<CallToolResult | InputRequiredResult>,
): Promise<CallToolResult | InputRequiredResult> {
  const started = new Date();
  try {
    const result = await run();
    const failed = "isError" in result && result.isError;
    await recordFunnelEvent(context.userId, "tool_call", {
      channel: "mcp",
      at: started,
      properties: {
        tool,
        outcome: failed ? "failed" : "succeeded",
        durationMs: Date.now() - started.getTime(),
        ...(failed ? { reason: measurementFailure(result._meta?.["simplepost/error"]) } : {}),
      },
    });
    return result;
  } catch (error) {
    await recordFunnelEvent(context.userId, "tool_call", {
      channel: "mcp",
      at: started,
      properties: {
        tool,
        outcome: "failed",
        reason: measurementFailure(error),
        durationMs: Date.now() - started.getTime(),
      },
    });
    throw error;
  }
}
