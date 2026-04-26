import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { listAccounts, listAccountsSchema } from "./tools/accounts";
import { uploadMedia, uploadMediaSchema } from "./tools/media";
import { createPost, createPostSchema } from "./tools/posts";
import { validatePost, validatePostSchema } from "./tools/validation";

export const SERVER_INSTRUCTIONS = `SimplePost lets the user publish or schedule posts to multiple social media platforms (X, Telegram, Facebook, Instagram, YouTube, ...) from a single tool call.

# Recommended workflow

1. Call \`list_accounts\` first to discover which platforms the user has connected and to get the \`accountId\` values you must pass to other tools. Never invent account IDs. If the list is empty, tell the user they need to connect an account in the SimplePost web app before posting — there is no MCP tool to add accounts.

2. If the post needs an image or video, attach it via the \`media\` field on \`validate_post\` / \`create_post\`. See the "Media" section below for how to obtain a URL.

3. Call \`validate_post\` before \`create_post\` whenever the message is long, contains links, includes media, or targets multiple platforms. It returns per-account errors and warnings (character limits, required media, platform-specific rules) so you can fix issues before publishing. Skip validation only for short, plain-text posts to a single account.

4. Call \`create_post\` to publish or schedule. Use \`postingMode: "now"\` for immediate publishing (the call blocks until each platform responds and returns \`postingResults\` per account). Use \`postingMode: "schedule"\` together with \`scheduledFor\` to schedule for later — the call returns immediately with \`status: "scheduled"\` and the scheduler will publish at that time.

# Media

Posts can include images and videos via the \`media\` array on \`validate_post\` and \`create_post\`. Each item is \`{ type: "image" | "video", url, thumbnailUrl? }\`. The \`url\` must be publicly fetchable.

There are two ways to get a usable \`url\`:

- **The user provides a URL** (most common — they paste a link, or it comes from an earlier tool result). Use it directly.
- **You have raw file bytes and no URL** (e.g. an image returned as base64 by another tool, or one the user attached locally). Call \`upload_media\` first with \`{ filename, mimeType, data }\` (data is base64). It uploads to SimplePost's storage and returns a public \`url\` you can put into the \`media\` array.

Notes:
- Some platforms require media: Instagram needs at least one image or video; YouTube needs a video. \`validate_post\` will surface these requirements as errors.
- Videos benefit from a \`thumbnailUrl\` but it is optional.
- Allowed types: image/jpeg, image/png, image/gif, image/webp, video/mp4, video/quicktime, video/webm. Maximum 500MB per file.
- If Claude Desktop is showing you an image that was pasted into the chat, you do NOT have access to its bytes via MCP — ask the user for a URL or to upload via the SimplePost web app.

# Time and scheduling

- \`scheduledFor\` must be an ISO 8601 datetime (e.g. \`2026-05-01T14:30:00Z\` or \`2026-05-01T16:30:00+02:00\`). Always include a timezone offset or \`Z\`; never send a naive local time.
- When the user says things like "tomorrow at 9am" or "next Monday", resolve to an absolute datetime in the user's timezone before calling the tool. If you don't know their timezone, ask.
- \`scheduledFor\` must be in the future. Past times are rejected.

# Error handling

- A successful \`create_post\` with \`postingMode: "now"\` may still report per-platform failures inside \`postingResults\`. Always inspect \`summary.overallSuccess\` and the individual results — do not assume success just because the tool didn't throw.
- If \`validate_post\` returns \`isValid: false\`, surface the per-account error messages to the user and offer a fix (shorter text, add media, drop a platform) instead of calling \`create_post\` anyway.

# What this server does NOT do

- It cannot connect, disconnect, or re-auth social accounts — direct the user to the SimplePost web app for that.
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
    "upload_media",
    `Upload an image or video to SimplePost storage and get back a public URL you can pass into \`create_post\` or \`validate_post\` via the \`media\` field.

Use this ONLY when you have raw file bytes and no public URL — e.g. an image returned as base64 by another tool, or a local file you've read. If the user already gave you a URL (or the file is hosted somewhere fetchable), skip this step and put the URL directly into \`media\`.

Inputs: \`filename\` (with extension), \`mimeType\` (e.g. \`image/png\`, \`video/mp4\`), and \`data\` (base64-encoded bytes, no \`data:\` prefix). Returns \`{ type, url, filename, size, mimeType }\` — pass \`type\` and \`url\` into the \`media\` array of \`create_post\`/\`validate_post\`.

Allowed types: image/jpeg, image/png, image/gif, image/webp, video/mp4, video/quicktime, video/webm. Maximum 500MB.`,
    uploadMediaSchema.shape,
    async (input) => {
      try {
        const result = await uploadMedia(userId, input);
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
    "validate_post",
    `Validate a post against the rules of every selected account WITHOUT publishing it. Returns \`isValid\` overall plus per-account \`errors\` (blocking) and \`warnings\` (non-blocking) — for example X character limits, Instagram requiring media, or platform-specific link handling.

Call this before \`create_post\` whenever the message is long, contains links, includes media, or targets multiple platforms. If \`isValid\` is false, surface the errors to the user and adjust the message, media, or account list before posting; do not call \`create_post\` with a known-invalid payload.`,
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
    `Publish a post immediately (\`postingMode: "now"\`) or schedule it for later (\`postingMode: "schedule"\` with an ISO 8601 \`scheduledFor\`). Supports text plus optional images/videos via the \`media\` field.

Always run \`list_accounts\` first to obtain valid \`accountIds\`. For multi-platform or long messages, run \`validate_post\` first; this tool also validates internally and will throw on invalid content. To attach media, pass an array of \`{ type, url, thumbnailUrl? }\` — the URL must be public. If you only have raw bytes, call \`upload_media\` first to get a URL.

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
