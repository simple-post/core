import {
  registerAppTool,
  type McpUiAppToolConfig,
  type ZodRawShape,
  type LegacyToolCallback,
} from "@modelcontextprotocol/ext-apps/server";

import { measureMcpTool } from "@/lib/analytics/tool-measurement";

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
/** Preserve the SDK's schema-derived callbacks and forward both supported schema forms unchanged. */
export function registerMeasuredTool<Input extends StandardSchemaWithJSON, Output extends StandardSchemaWithJSON>(
  context: { userId: string },
  server: Server,
  name: string,
  config: McpUiAppToolConfig & { inputSchema: Input; outputSchema?: Output },
  callback: (input: StandardSchemaWithJSON.InferOutput<Input>, ctx: ServerContext) => Result | Promise<Result>,
): RegisteredTool;
export function registerMeasuredTool<
  Input extends ZodRawShape,
  Output extends ZodRawShape | StandardSchemaWithJSON | undefined = undefined,
>(
  context: { userId: string },
  server: Server,
  name: string,
  config: McpUiAppToolConfig & { inputSchema: Input; outputSchema?: Output },
  callback: LegacyToolCallback<Input>,
): RegisteredTool;
export function registerMeasuredTool(
  context: { userId: string },
  server: Server,
  name: string,
  config: McpUiAppToolConfig,
  callback: (input: never, ctx: ServerContext) => Result | Promise<Result>,
): RegisteredTool {
  // The overloads retain public input inference. This internal bridge only adds observation;
  // it must not wrap/convert a raw shape, which could change SDK validation/error behavior.
  const measured = (input: never, ctx: ServerContext) =>
    measureMcpTool(context, name, async () => callback(input, ctx));
  return registerAppTool(
    server,
    name,
    config as McpUiAppToolConfig & { inputSchema: StandardSchemaWithJSON; outputSchema?: StandardSchemaWithJSON },
    measured as ToolCallback<StandardSchemaWithJSON>,
  );
}
