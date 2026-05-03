import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerSimplePostAppResource, SIMPLEPOST_WIDGET_URI } from "./app-ui";
import { hasMcpScope, MCP_SCOPES, type McpScope } from "./config";
import { listAccounts, listAccountsOutputSchema, listAccountsSchema } from "./tools/accounts";
import { uploadMedia, uploadMediaOutputSchema, uploadMediaSchema } from "./tools/media";
import {
  createPost,
  createPostOutputSchema,
  createPostSchema,
  previewPost,
  previewPostOutputSchema,
  previewPostSchema,
} from "./tools/posts";
import { validatePost, validatePostOutputSchema, validatePostSchema } from "./tools/validation";

export const SERVER_INSTRUCTIONS = `SimplePost lets the user publish or schedule posts to multiple social media platforms (X, Telegram, Facebook, Instagram, YouTube, Meta Threads, ...) from a single tool call.

# Recommended workflow

1. Call \`list_accounts\` first to discover which platforms the user has connected and to get the \`accountId\` values you must pass to other tools. Never invent account IDs. If the list is empty, tell the user they need to connect an account in the SimplePost web app before posting — there is no MCP tool to add accounts.

2. If the post needs an image or video, attach it via the \`media\` field on \`validate_post\`, \`preview_post\`, and \`create_post\`. See the "Media" section below for how to obtain a URL.

3. Do not call \`validate_post\` as a default preflight before posting. \`create_post\` already performs the same blocking validation internally and fails safely with platform-specific errors. Use \`validate_post\` only when the user explicitly asks to validate, check, test, or troubleshoot a draft without creating a post.

4. Use \`preview_post\` only when the user explicitly asks for a preview or when the requested post is missing essential details such as target account, media choice, or scheduling time. If the user has already confirmed the exact content, accounts, media, thread segments (if any), and timing, call \`create_post\` directly after \`list_accounts\` and any required media upload.

5. Use \`postingMode: "now"\` for immediate publishing (the call blocks until each platform responds and returns \`postingResults\` per account). Use \`postingMode: "schedule"\` together with \`scheduledFor\` to schedule for later — the call returns immediately with \`status: "scheduled"\` and the scheduler will publish at that time.

# Media

Posts can include images and videos via the \`media\` array on \`validate_post\`, \`preview_post\`, and \`create_post\`. Each item is \`{ type: "image" | "video", url, thumbnailUrl? }\`. The \`url\` must be publicly fetchable.

There are two ways to get a usable \`url\`:

- **The user provides a URL** (most common — they paste a link, or it comes from an earlier tool result). Use it directly.
- **ChatGPT has a generated or attached file with no public URL**. Call \`upload_media\` with the \`file\` file parameter so SimplePost can download and validate the bytes server-side. Do not transcribe large ChatGPT images into base64 tool arguments; \`upload_media\` does not accept base64 media data.

Notes:
- Some platforms require media: Instagram needs at least one image or video; YouTube needs a video. \`validate_post\` and \`preview_post\` will surface these requirements as errors.
- Videos benefit from a \`thumbnailUrl\` but it is optional.
- Allowed upload types: image/jpeg, image/png, image/gif, image/webp, video/mp4, video/quicktime, video/webm. Maximum 500MB per file.
- \`upload_media\` validates that image/video bytes match the declared type before returning a SimplePost URL.
- If the client is showing an image but exposes neither a public URL nor a file parameter to tools, ask the user for a public URL or to upload via the SimplePost web app.

# Multi-segment threads (reply chains)

Use the \`thread\` field on \`validate_post\`, \`preview_post\`, and \`create_post\` when the user wants more than one connected post: the root is always \`message\` plus optional root \`media\`, and \`thread\` is an ordered array of follow-up segments \`{ message, media? }\`.

- **Thread-capable platforms** (native reply chains): \`x\`, \`bluesky\`, \`threads\` (Meta Threads), \`telegram\`. Each segment is published in order as a reply to the previous one. There is a short delay between segments so APIs can resolve parent ids (especially Meta Threads).
- **Other platforms** in the same \`create_post\` call still receive only the **root** segment; validation surfaces a **warning** (not a hard error) that extra segments are dropped for those accounts.
- **Limits**: at most 24 follow-up segments after the root (25 posts total on X). Each segment has its own text and optional \`media\`; per-segment media uses the same URL rules as the root.
- **When to validate**: do not call \`validate_post\` automatically just because \`thread\` is non-empty. \`create_post\` validates every segment before creating or publishing. Use \`validate_post\` only when the user asks for validation-only feedback, and use \`preview_post\` only when the user asks for a preview or details are missing.
- After \`create_post\` with \`postingMode: "now"\`, inspect \`postingResults[].threadResults\` for per-segment success, \`postId\`, and \`postUrl\` when the platform returned them.

# Time and scheduling

- \`scheduledFor\` must be an ISO 8601 datetime (e.g. \`2026-05-01T14:30:00Z\` or \`2026-05-01T16:30:00+02:00\`). Always include a timezone offset or \`Z\`; never send a naive local time.
- When the user says things like "tomorrow at 9am" or "next Monday", resolve to an absolute datetime in the user's timezone before calling the tool. If you don't know their timezone, ask.
- \`scheduledFor\` must be in the future. Past times are rejected.

# Error handling

- A successful \`create_post\` with \`postingMode: "now"\` may still report per-platform failures inside \`postingResults\`. Always inspect \`summary.overallSuccess\` and the individual results — do not assume success just because the tool didn't throw. For threads, a root post can succeed while a later segment fails; check \`threadResults\` on that account.
- If \`validate_post\` or \`preview_post\` was explicitly requested and returns \`isValid: false\`, surface the per-account error messages to the user and offer a fix (shorter text, add media, drop a platform) instead of calling \`create_post\` anyway.

# What this server does NOT do

- It cannot connect, disconnect, or re-auth social accounts — direct the user to the SimplePost web app for that.
- It cannot list, edit, or cancel scheduled posts via MCP — those live in the web app.`;

export interface McpToolAuthContext {
  userId: string;
  scope?: string | null;
}

const OAUTH_SECURITY_SCHEMES = [{ type: "oauth2", scopes: [...MCP_SCOPES] }];

function toolMeta(invoking: string, invoked: string) {
  return {
    securitySchemes: OAUTH_SECURITY_SCHEMES,
    ui: { resourceUri: SIMPLEPOST_WIDGET_URI },
    "openai/outputTemplate": SIMPLEPOST_WIDGET_URI,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}

function errorResult(error: unknown) {
  return {
    content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
    isError: true,
  };
}

function requireScope(context: McpToolAuthContext, scope: McpScope): void {
  if (!hasMcpScope(context.scope, scope)) {
    throw new Error(`Missing required OAuth scope: ${scope}`);
  }
}

/**
 * Register all SimplePost MCP tools on the given server instance.
 * The userId is bound to tool handlers so they operate on the authenticated user's data.
 */
export function registerTools(server: McpServer, context: McpToolAuthContext): void {
  registerSimplePostAppResource(server);

  registerAppTool(
    server,
    "list_accounts",
    {
      title: "List Connected Accounts",
      description: `List the social media accounts the authenticated user has connected to SimplePost. Call this first in any posting workflow. The returned accountId values are required by validate_post, preview_post, and create_post, and account IDs are not guessable.`,
      inputSchema: listAccountsSchema.shape,
      outputSchema: listAccountsOutputSchema.shape,
      annotations: {
        title: "List connected SimplePost accounts",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: toolMeta("Loading accounts", "Accounts loaded"),
    },
    async () => {
      try {
        requireScope(context, "accounts:read");
        const result = await listAccounts(context.userId);
        return {
          structuredContent: result,
          content: [{ type: "text", text: `${result.summary.total} SimplePost account(s) available.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  registerAppTool(
    server,
    "upload_media",
    {
      title: "Upload Media",
      description: `Upload a ChatGPT generated or attached image/video file to SimplePost storage and get back a public URL you can pass into validate_post, preview_post, or create_post through the media field. This tool requires the file parameter; do not pass base64 media data. If the user already gave a fetchable URL, skip this tool and use the URL directly.`,
      inputSchema: uploadMediaSchema.shape,
      outputSchema: uploadMediaOutputSchema.shape,
      annotations: {
        title: "Upload media to SimplePost",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: {
        ...toolMeta("Uploading media", "Media uploaded"),
        "openai/fileParams": ["file"],
      },
    },
    async (input) => {
      try {
        requireScope(context, "posts:write");
        const result = await uploadMedia(context.userId, input);
        return {
          structuredContent: result,
          content: [{ type: "text", text: `Uploaded ${result.type} ${result.filename}.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  registerAppTool(
    server,
    "validate_post",
    {
      title: "Validate Post",
      description: `Validate post text and optional media against the rules of each selected connected account without creating or publishing anything. Use this only when the user explicitly asks to validate, check, test, or troubleshoot a draft. Do not call it as a default preflight before create_post because create_post validates internally.`,
      inputSchema: validatePostSchema.shape,
      outputSchema: validatePostOutputSchema.shape,
      annotations: {
        title: "Validate a SimplePost draft",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: toolMeta("Validating post", "Validation ready"),
    },
    async (input) => {
      try {
        requireScope(context, "posts:validate");
        const result = await validatePost(context.userId, input);
        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text: result.isValid
                ? `Post is valid for ${result.summary.accountCount} account(s).`
                : `Post has ${result.summary.errorCount} blocking validation error(s).`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  registerAppTool(
    server,
    "preview_post",
    {
      title: "Preview Post",
      description: `Preview a post before it is created. This resolves target accounts, optional media count, optional thread segment count, scheduled time, and validation result without writing to SimplePost or publishing to social platforms. Use it when the user explicitly asks for a preview or when essential posting details are missing; do not use it as a default preflight for already-confirmed posts.`,
      inputSchema: previewPostSchema.shape,
      outputSchema: previewPostOutputSchema.shape,
      annotations: {
        title: "Preview a SimplePost draft",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: toolMeta("Preparing preview", "Preview ready"),
    },
    async (input) => {
      try {
        requireScope(context, "posts:validate");
        const result = await previewPost(context.userId, input);
        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text: result.validation.isValid
                ? `Preview ready for ${result.summary.accountCount} account(s), ${result.summary.mediaCount} root media item(s)${
                    result.summary.threadSegmentCount > 0
                      ? `, ${result.summary.threadSegmentCount} follow-up thread segment(s)`
                      : ""
                  }.`
                : `Preview found ${result.summary.errorCount} blocking validation error(s).`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  registerAppTool(
    server,
    "create_post",
    {
      title: "Create Post",
      description: `Create a SimplePost post with text plus optional images/videos and optional multi-segment thread (thread field: follow-up messages after the root). Use postingMode "now" to publish immediately or "schedule" with a future ISO 8601 scheduledFor value to schedule it. This is a write action that can publish public content on connected social platforms and it performs blocking validation internally, so do not call validate_post first unless the user requested validation-only feedback. Always call list_accounts first to get account IDs.`,
      inputSchema: createPostSchema.shape,
      outputSchema: createPostOutputSchema.shape,
      annotations: {
        title: "Create or publish a SimplePost post",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: toolMeta("Creating post", "Post created"),
    },
    async (input) => {
      try {
        requireScope(context, "posts:write");
        const result = await createPost(context.userId, input);
        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text:
                result.post.status === "scheduled"
                  ? `Post scheduled for ${result.post.scheduledFor} across ${result.summary.scheduledCount} account(s)${
                      result.summary.threadSegmentCount > 0
                        ? ` (${result.summary.threadSegmentCount} follow-up thread segment(s) each)`
                        : ""
                    }.`
                  : result.summary.overallSuccess
                    ? `Post published successfully across ${result.summary.successCount} account(s)${
                        result.summary.threadSegmentCount > 0
                          ? ` with ${result.summary.threadSegmentCount} follow-up thread segment(s) per thread-capable account`
                          : ""
                      }.`
                    : `Post completed with ${result.summary.failureCount} platform failure(s).`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
