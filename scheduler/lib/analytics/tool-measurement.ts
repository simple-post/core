import { prisma } from "@/lib/prisma";

import { normalizeAiClient } from "./activation";
import { measurementFailure, recordFunnelEvent } from "./events";

import type { CallToolResult } from "@modelcontextprotocol/server";

/** Only registered tool invocations reach this wrapper; discovery and pings do not. Retries are attempts, not additional people. */
export async function measureMcpTool(
  context: { userId: string; clientId?: string },
  tool: string,
  run: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  let client = "other-mcp";
  try {
    const row = context.clientId
      ? await prisma.mcpOAuthClient.findUnique({ where: { clientId: context.clientId }, select: { name: true } })
      : null;
    client = normalizeAiClient(row?.name);
  } catch {
    /* Optional client metadata never blocks a tool. */
  }
  const properties = { tool, client };
  const started = Date.now();
  await recordFunnelEvent(context.userId, "tool_called", { channel: "mcp", properties });
  if (["create_post", "commit_post_editor_session"].includes(tool))
    await recordFunnelEvent(context.userId, "post_create_attempted", { channel: "mcp", properties });
  try {
    const result = await run();
    await recordFunnelEvent(context.userId, result.isError ? "tool_failed" : "tool_succeeded", {
      channel: "mcp",
      properties: {
        ...properties,
        ...(result.isError ? { reason: measurementFailure(result._meta?.["simplepost/error"]) } : {}),
        durationMs: Date.now() - started,
      },
    });
    return result;
  } catch (error) {
    await recordFunnelEvent(context.userId, "tool_failed", {
      channel: "mcp",
      properties: { ...properties, reason: measurementFailure(error), durationMs: Date.now() - started },
    });
    throw error;
  }
}
