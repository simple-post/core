import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { listAccounts, listAccountsSchema } from "./tools/accounts";
import { createPost, createPostSchema } from "./tools/posts";
import { validatePost, validatePostSchema } from "./tools/validation";

/**
 * Register all SimplePost MCP tools on the given server instance.
 * The userId is bound to tool handlers so they operate on the authenticated user's data.
 */
export function registerTools(server: McpServer, userId: string): void {
  server.tool(
    "list_accounts",
    "List all connected social media accounts. Returns account IDs needed for creating posts.",
    listAccountsSchema.shape,
    async () => {
      try {
        const accounts = await listAccounts(userId);
        return {
          content: [{ type: "text", text: JSON.stringify(accounts, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "validate_post",
    "Validate post content against platform rules before creating it. Checks character limits, media requirements, etc.",
    validatePostSchema.shape,
    async (input) => {
      try {
        const result = await validatePost(userId, input);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "create_post",
    "Create a social media post. Can post immediately or schedule for a future time. Use list_accounts first to get account IDs.",
    createPostSchema.shape,
    async (input) => {
      try {
        const result = await createPost(userId, input);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
