import { defineRoute, emptyResponse, jsonResponse, mcpAuthSecurity } from "@/lib/openapi/helpers";
import { ApiErrorSchema, McpJsonRpcRequestSchema, McpJsonRpcResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/mcp",
  methods: {
    get: {
      operationId: "getMcpEndpoint",
      tags: ["MCP"],
      summary: "Reject SSE MCP transport",
      description: "The Scheduler MCP server is stateless and only supports Streamable HTTP POST requests.",
      security: mcpAuthSecurity,
      responses: {
        "405": jsonResponse("SSE transport is not supported.", ApiErrorSchema),
        "401": jsonResponse("Missing or invalid MCP bearer token.", ApiErrorSchema),
      },
    },
    post: {
      operationId: "postMcpJsonRpc",
      tags: ["MCP"],
      summary: "Handle MCP Streamable HTTP JSON-RPC",
      security: mcpAuthSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: McpJsonRpcRequestSchema,
          },
        },
      },
      responses: {
        "200": jsonResponse("MCP JSON-RPC response.", McpJsonRpcResponseSchema),
        "401": jsonResponse("Missing or invalid MCP bearer token.", ApiErrorSchema),
        "500": jsonResponse("MCP JSON-RPC error response.", McpJsonRpcResponseSchema),
      },
    },
    delete: {
      operationId: "deleteMcpSession",
      tags: ["MCP"],
      summary: "Terminate MCP session",
      description: "No-op in stateless mode.",
      responses: {
        "204": emptyResponse("No content."),
      },
    },
  },
});
