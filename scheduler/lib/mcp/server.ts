import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { listAccounts, listAccountsSchema } from "./tools/accounts";
import { createPost, createPostSchema } from "./tools/posts";
import { validatePost, validatePostSchema } from "./tools/validation";

export const SERVER_INSTRUCTIONS = `SimplePost lets the user publish or schedule posts to multiple social media platforms (X, Telegram, Facebook, Instagram, YouTube, ...) from a single tool call.

# Recommended workflow

1. Call \`list_accounts\` first to discover which platforms the user has connected and to get the \`accountId\` values you must pass to other tools. Never invent account IDs. If the list is empty, tell the user they need to connect an account in the SimplePost web app before posting — there is no MCP tool to add accounts.

2. Call \`validate_post\` before \`create_post\` whenever the message is long, contains links, or targets multiple platforms. It returns per-account errors and warnings (character limits, required media, platform-specific rules) so you can fix issues before publishing. Skip validation only for short, plain-text posts to a single account.

3. Call \`create_post\` to publish or schedule. Use \`postingMode: "now"\` for immediate publishing (the call blocks until each platform responds and returns \`postingResults\` per account). Use \`postingMode: "schedule"\` together with \`scheduledFor\` to schedule for later — the call returns immediately with \`status: "scheduled"\` and the scheduler will publish at that time.

# Time and scheduling

- \`scheduledFor\` must be an ISO 8601 datetime (e.g. \`2026-05-01T14:30:00Z\` or \`2026-05-01T16:30:00+02:00\`). Always include a timezone offset or \`Z\`; never send a naive local time.
- When the user says things like "tomorrow at 9am" or "next Monday", resolve to an absolute datetime in the user's timezone before calling the tool. If you don't know their timezone, ask.
- \`scheduledFor\` must be in the future. Past times are rejected.

# Error handling

- A successful \`create_post\` with \`postingMode: "now"\` may still report per-platform failures inside \`postingResults\`. Always inspect \`summary.overallSuccess\` and the individual results — do not assume success just because the tool didn't throw.
- If \`validate_post\` returns \`isValid: false\`, surface the per-account error messages to the user and offer a fix (shorter text, add media, drop a platform) instead of calling \`create_post\` anyway.

# What this server does NOT do

- It cannot connect, disconnect, or re-auth social accounts — direct the user to the SimplePost web app for that.
- It cannot upload media yet; \`create_post\` currently posts text only. If the user asks to attach images or video, tell them to use the web app.
- It cannot list, edit, or cancel scheduled posts via MCP — those live in the web app.`;

/**
 * Register all SimplePost MCP tools on the given server instance.
 * The userId is bound to tool handlers so they operate on the authenticated user's data.
 */
export function registerTools(server: McpServer, userId: string): void {
  server.tool(
    "list_accounts",
    `List the social media accounts the authenticated user has connected to SimplePost. Returns an array of accounts with \`id\`, \`platform\` (e.g. "x", "telegram", "facebook"), \`username\`, \`displayName\`, and \`profilePicture\`.

Call this FIRST in any posting workflow — the \`id\` values are required by \`validate_post\` and \`create_post\`, and account IDs are not guessable. An empty array means the user has not connected any accounts; ask them to connect one in the SimplePost web app before continuing (there is no MCP tool to add accounts).`,
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
    `Validate a post against the rules of every selected account WITHOUT publishing it. Returns \`isValid\` overall plus per-account \`errors\` (blocking) and \`warnings\` (non-blocking) — for example X character limits, Instagram requiring media, or platform-specific link handling.

Call this before \`create_post\` whenever the message is long, contains links, or targets multiple platforms. If \`isValid\` is false, surface the errors to the user and adjust the message or account list before posting; do not call \`create_post\` with a known-invalid payload.`,
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
    `Publish a post immediately (\`postingMode: "now"\`) or schedule it for later (\`postingMode: "schedule"\` with an ISO 8601 \`scheduledFor\`). Currently text-only — media uploads are not supported via MCP.

Always run \`list_accounts\` first to obtain valid \`accountIds\`. For multi-platform or long messages, run \`validate_post\` first; this tool also validates internally and will throw on invalid content.

When posting now, the call blocks until each platform responds. Inspect \`summary.overallSuccess\` and \`postingResults[]\` in the return value — partial failures are reported there, not by throwing. When scheduling, the call returns immediately with the post in \`status: "scheduled"\` and the scheduler publishes at \`scheduledFor\`. \`scheduledFor\` must be a future ISO 8601 datetime with a timezone offset or \`Z\`; resolve relative times like "tomorrow at 9am" to absolute UTC/offset before calling.`,
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
