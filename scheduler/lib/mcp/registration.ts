import { randomUUID } from "node:crypto";

import {
  registerAppTool,
  type McpUiAppToolConfig,
  type ZodRawShape,
  type LegacyToolCallback,
} from "@modelcontextprotocol/ext-apps/server";

import { recordFunnelEvent } from "@/lib/analytics/events";
import { measureMcpTool } from "@/lib/analytics/tool-measurement";
import { toMcpErrorDiagnostic } from "@/lib/mcp/tool-errors";
import { PaymentRequiredError } from "@/lib/utils/errors";

import type {
  CallToolResult,
  InputRequiredResult,
  McpServer,
  StandardSchemaWithJSON,
  ServerContext,
  ToolCallback,
  RegisteredTool,
} from "@modelcontextprotocol/server";

type Result = CallToolResult | InputRequiredResult;
type Server = Pick<McpServer, "registerTool">;
type ToolAccess = { userId: string; readOnly?: boolean };
const SAVED_DATA_TOOLS = new Set([
  "list_accounts",
  "inspect_posts",
  "get_schedule",
  "show_schedule",
  "show_post_preview",
]);
/** Preserve the SDK's schema-derived callbacks and forward both supported schema forms unchanged. */
export function registerMeasuredTool<Input extends StandardSchemaWithJSON, Output extends StandardSchemaWithJSON>(
  context: ToolAccess,
  server: Server,
  name: string,
  config: McpUiAppToolConfig & { inputSchema: Input; outputSchema?: Output },
  callback: (input: StandardSchemaWithJSON.InferOutput<Input>, ctx: ServerContext) => Result | Promise<Result>,
): RegisteredTool;
export function registerMeasuredTool<
  Input extends ZodRawShape,
  Output extends ZodRawShape | StandardSchemaWithJSON | undefined = undefined,
>(
  context: ToolAccess,
  server: Server,
  name: string,
  config: McpUiAppToolConfig & { inputSchema: Input; outputSchema?: Output },
  callback: LegacyToolCallback<Input>,
): RegisteredTool;
export function registerMeasuredTool(
  context: ToolAccess,
  server: Server,
  name: string,
  config: McpUiAppToolConfig,
  callback: (input: never, ctx: ServerContext) => Result | Promise<Result>,
): RegisteredTool {
  // Preserve schema inference and SDK validation while measuring calls and
  // enforcing the narrow saved-data exception for expired trials.
  const measured = (input: never, ctx: ServerContext) =>
    measureMcpTool(context, name, async () => {
      if (
        context.readOnly &&
        (!SAVED_DATA_TOOLS.has(name) || (name === "show_post_preview" && !(input as { postId?: string }).postId))
      ) {
        await recordFunnelEvent(context.userId, "billing_denied", {
          key: `${context.userId}:${name}:${new Date().toISOString().slice(0, 10)}`,
          properties: { reason: "trial_expired", method: name },
        });
        const diagnostic = {
          ...toMcpErrorDiagnostic(
            new PaymentRequiredError(
              "Your trial has ended. Saved posts, accounts and the calendar are still viewable. Creating or changing posts requires an active plan in SimplePost.",
            ),
          ),
          supportId: randomUUID(),
        };
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `${diagnostic.message}\nSIMPLEPOST_ERROR ${JSON.stringify(diagnostic)}`,
            },
          ],
          _meta: { "simplepost/retryable": false, "simplepost/error": diagnostic },
        };
      }
      return callback(input, ctx);
    });
  return registerAppTool(
    server,
    name,
    config as McpUiAppToolConfig & { inputSchema: StandardSchemaWithJSON; outputSchema?: StandardSchemaWithJSON },
    measured as ToolCallback<StandardSchemaWithJSON>,
  );
}
