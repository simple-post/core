import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { hasMcpScope, MCP_SCOPES, type McpScope } from "./config";
import { formatBytes, formatDateTime, platformLabel, plural } from "./format";
import { MCP_TOOL_ANNOTATIONS } from "./tool-annotations";
import { listAccounts, listAccountsOutputSchema, listAccountsSchema } from "./tools/accounts";
import { uploadMedia, uploadMediaOutputSchema, uploadMediaSchema } from "./tools/media";
import {
  createPost,
  createPostOutputSchema,
  createPostSchema,
  discardScheduledPost,
  discardScheduledPostOutputSchema,
  discardScheduledPostSchema,
  inspectPosts,
  inspectPostsOutputSchema,
  inspectPostsSchema,
  previewPost,
  previewPostOutputSchema,
  previewPostSchema,
  updateScheduledPost,
  updateScheduledPostOutputSchema,
  updateScheduledPostSchema,
} from "./tools/posts";
import { validatePost, validatePostOutputSchema, validatePostSchema } from "./tools/validation";

export const SERVER_INSTRUCTIONS = `SimplePost lets the user publish or schedule posts to multiple social media platforms (X, Telegram, Facebook, Instagram, YouTube, Meta Threads, ...) from a single tool call. Only call tools for SimplePost posting workflows. Do not call tools for generic writing help, connecting accounts, or editing/deleting social posts that were already published externally; explain those are unsupported and direct the user to the SimplePost web app or social platform.

# Recommended workflow

1. Call \`list_accounts\` first to discover which platforms the user has connected and to get the \`accountId\` values you must pass to other tools. Never invent account IDs. If the list is empty, tell the user they need to connect an account in the SimplePost web app before posting — there is no MCP tool to add accounts.

2. If the post needs an image or video, attach it via the \`media\` field on \`validate_post\`, \`preview_post\`, and \`create_post\`. See the "Media" section below for how to obtain a URL.

3. Do not call \`validate_post\` as a default preflight before posting. \`create_post\` already performs the same blocking validation internally and fails safely with platform-specific errors. Use \`validate_post\` only when the user explicitly asks to validate, check, test, or troubleshoot a draft without creating a post.

4. Use \`preview_post\` only when the user explicitly asks for a preview or when the requested post is missing essential details such as target account, media choice, or scheduling time. If the user has already confirmed the exact content, accounts, media, thread segments (if any), and timing, call \`create_post\` directly after \`list_accounts\` and any required media upload.

5. Use \`postingMode: "now"\` for immediate publishing (the call blocks until each platform responds and returns \`postingResults\` per account). Use \`postingMode: "schedule"\` together with \`scheduledFor\` to schedule for later — the call returns immediately with \`status: "scheduled"\` and the scheduler will publish at that time. Use \`postingMode: "draft"\` to save the post in SimplePost without publishing or scheduling it.

6. Use \`inspect_posts\` when the user asks what is drafted, scheduled, already posted, or failed. Use \`update_scheduled_post\` for drafts or future scheduled posts when the user wants to change content, accounts, root media, thread, scheduled time, or move between draft and scheduled. Use \`discard_scheduled_post\` when the user asks to cancel or delete a draft or future scheduled post.

# Visible text responses

- This is a text-only ChatGPT app. After \`preview_post\`, \`create_post\`, \`inspect_posts\`, \`update_scheduled_post\`, or \`discard_scheduled_post\`, always include the exact post content in the assistant's visible answer so the user can see what was previewed, posted, scheduled, edited, or discarded.
- For threads, show the root post and each follow-up segment in order. Do not hide the post text behind only a status, count, or URL.

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

Use the \`thread\` field on \`validate_post\`, \`preview_post\`, and \`create_post\` when the user wants more than one connected post: the root is always \`message\` plus optional root \`media\`, and \`thread\` is an ordered array of follow-up segments \`{ message, media? }\`. Segment \`media\` has the same object format as root media: \`{ type: "image" | "video", url, thumbnailUrl? }\`.

- **Thread-capable platforms** (native reply chains): \`x\`, \`bluesky\`, \`threads\` (Meta Threads), \`telegram\`. Each segment is published in order as a reply to the previous one. There is a short delay between segments so APIs can resolve parent ids (especially Meta Threads).
- **Other platforms** in the same \`create_post\` call still receive only the **root** segment; validation surfaces a **warning** (not a hard error) that extra segments are dropped for those accounts.
- **Limits**: at most 24 follow-up segments after the root (25 posts total on X). Each segment has its own text and optional \`media\`; per-segment media uses the same URL rules as the root.
- **When to validate**: do not call \`validate_post\` automatically just because \`thread\` is non-empty. \`create_post\` validates every segment before creating or publishing. Use \`validate_post\` only when the user asks for validation-only feedback, and use \`preview_post\` only when the user asks for a preview or details are missing.
- After \`create_post\` with \`postingMode: "now"\`, inspect \`postingResults[].threadResults\` for per-segment success, \`postId\`, and \`postUrl\` when the platform returned them.

# Time and scheduling

- \`scheduledFor\` must be an ISO 8601 datetime (e.g. \`2026-05-01T14:30:00Z\` or \`2026-05-01T16:30:00+02:00\`). Always include a timezone offset or \`Z\`; never send a naive local time.
- When the user says things like "tomorrow at 9am" or "next Monday", resolve to an absolute datetime in the user's timezone before calling the tool. If you don't know their timezone, ask.
- \`scheduledFor\` must be in the future when \`postingMode: "schedule"\`. Past times are rejected. Drafts do not need \`scheduledFor\`.

# Managing existing posts

- \`inspect_posts\` can list drafts, future scheduled posts, already posted posts, and failed posts. Pass a \`postId\` to inspect a single post before editing or discarding it.
- \`update_scheduled_post\` accepts partial updates. Omitted fields keep their current values; \`postingMode: "draft"\` moves a scheduled post to drafts, and \`postingMode: "schedule"\` plus \`scheduledFor\` moves a draft to scheduled (sending \`scheduledFor\` for a draft without \`postingMode\` also moves it to scheduled). Root \`media: null\` or \`media: []\` clears root media. \`thread: null\` or \`thread: []\` clears all follow-up segments. To keep a thread segment but remove only that segment's media, include the segment with \`media: []\`; segment media items use \`{ type, url, thumbnailUrl? }\`.
- \`update_scheduled_post\` validates the resulting scheduled post before saving changes. Draft saves are allowed even if platform validation would block publishing. If validation fails for a scheduled result, surface the per-account errors and do not call \`create_post\`.
- \`discard_scheduled_post\` deletes a draft or future scheduled post and its stored media from SimplePost. It cannot undo posts that were already published to social platforms.

# Error handling

- A successful \`create_post\` with \`postingMode: "now"\` may still report per-platform failures inside \`postingResults\`. Always inspect \`summary.overallSuccess\` and the individual results — do not assume success just because the tool didn't throw. For threads, a root post can succeed while a later segment fails; check \`threadResults\` on that account.
- If \`validate_post\` or \`preview_post\` was explicitly requested and returns \`isValid: false\`, surface the per-account error messages to the user and offer a fix (shorter text, add media, drop a platform) instead of calling \`create_post\` anyway.

# What this server does NOT do

- It cannot connect, disconnect, or re-auth social accounts — direct the user to the SimplePost web app for that.
- It cannot edit or discard posts that are already published, failed, pending, or due for dispatch.`;

export interface McpToolAuthContext {
  userId: string;
  scope?: string | null;
}

const OAUTH_SECURITY_SCHEMES = [{ type: "oauth2", scopes: [...MCP_SCOPES] }];

function toolMeta(invoking: string, invoked: string) {
  return {
    securitySchemes: OAUTH_SECURITY_SCHEMES,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}

function errorResult(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

const SCOPE_ACTIONS: Record<McpScope, string> = {
  "accounts:read": "view your connected accounts",
  "posts:read": "view your posts",
  "posts:validate": "check posts against platform rules",
  "posts:write": "create or change posts",
};

function requireScope(context: McpToolAuthContext, scope: McpScope): void {
  if (!hasMcpScope(context.scope, scope)) {
    throw new Error(
      `SimplePost doesn't have permission to ${SCOPE_ACTIONS[scope]} for this connection. Please reconnect SimplePost and approve the requested access (missing OAuth scope: ${scope}).`,
    );
  }
}

function formatPostContent(message: string, thread?: Array<{ message?: string }>): string {
  const segments = (thread ?? []).filter((segment) => segment.message !== undefined);
  if (segments.length === 0) {
    return `Post content:\n${message}`;
  }

  return [
    `Post content:\nRoot:\n${message}`,
    ...segments.map((segment, index) => `Reply ${index + 1}:\n${segment.message ?? ""}`),
  ].join("\n\n");
}

function formatManagedPostContent(post: { message: string; thread?: Array<{ message?: string }> }): string {
  return formatPostContent(post.message, post.thread);
}

interface AccountSummary {
  accountId: string;
  platform: string;
  username?: string | null;
  displayName?: string | null;
}

interface ValidationIssue {
  message: string;
  field?: string;
}

interface ValidationAccount extends AccountSummary {
  isValid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

function formatAccount(account: AccountSummary): string {
  const handle = account.username ? `@${account.username}` : null;
  const name =
    account.displayName && handle && account.displayName !== handle
      ? `${account.displayName} (${handle})`
      : (account.displayName ?? handle ?? "Unnamed account");
  return `${name} on ${platformLabel(account.platform)} (account ID: ${account.accountId})`;
}

function formatAccounts(accounts: AccountSummary[]): string {
  if (accounts.length === 0)
    return "You don't have any connected accounts yet. Connect one in the SimplePost web app to start posting.";

  return `Connected accounts:\n${accounts.map((account) => `- ${formatAccount(account)}`).join("\n")}`;
}

function formatValidationIssue(issue: ValidationIssue): string {
  return issue.field ? `${issue.field}: ${issue.message}` : issue.message;
}

function formatValidationDetails(validation: {
  accounts: ValidationAccount[];
  summary: { errorCount: number; warningCount: number };
}): string {
  if (validation.accounts.length === 0) {
    return "Validation: no matching accounts were checked.";
  }

  const { errorCount, warningCount } = validation.summary;
  const headline =
    errorCount === 0 && warningCount === 0
      ? "Validation: all good — no errors or warnings."
      : `Validation: ${plural(errorCount, "error")}, ${plural(warningCount, "warning")}.`;

  const accounts = validation.accounts
    .map((account) => {
      const errors = account.errors.map((issue) => formatValidationIssue(issue));
      const warnings = account.warnings.map((issue) => formatValidationIssue(issue));
      const details = [
        errors.length > 0 ? `errors: ${errors.join("; ")}` : "",
        warnings.length > 0 ? `warnings: ${warnings.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("; ");

      return `- ${formatAccount(account)}: ${account.isValid ? "OK" : "has issues"}${details ? ` (${details})` : ""}`;
    })
    .join("\n");

  return `${headline}\n${accounts}`;
}

function formatTiming(postingMode: string, scheduledFor: string | null): string {
  if (postingMode === "draft") return "When: saved as a draft (not scheduled)";
  if (postingMode === "schedule" && scheduledFor) return `When: scheduled for ${formatDateTime(scheduledFor)}`;
  return "When: published immediately";
}

function formatPreviewDetails(result: {
  postingMode: string;
  scheduledFor: string | null;
  mediaCount: number;
  accounts: AccountSummary[];
  validation: { accounts: ValidationAccount[]; summary: { errorCount: number; warningCount: number } };
  summary: { threadSegmentCount: number };
}): string {
  return [
    "Preview details:",
    formatTiming(result.postingMode, result.scheduledFor),
    result.mediaCount > 0 ? `Media: ${plural(result.mediaCount, "item")}` : "",
    result.summary.threadSegmentCount > 0
      ? `Thread: ${plural(result.summary.threadSegmentCount, "follow-up reply", "follow-up replies")}`
      : "",
    formatAccounts(result.accounts),
    formatValidationDetails(result.validation),
  ]
    .filter(Boolean)
    .join("\n");
}

function formatPostingResults(
  results: Array<{
    accountId: string;
    platform: string;
    success: boolean;
    error?: string;
    message?: string;
    postUrl?: string;
    postId?: string;
    threadResults?: Array<{
      index: number;
      success: boolean;
      postId?: string;
      postUrl?: string;
      error?: string;
      message?: string;
    }>;
  }>,
): string {
  if (results.length === 0) {
    return "";
  }

  return `Posting results:\n${results
    .map((result) => {
      const details = [
        result.postUrl ? `link: ${result.postUrl}` : "",
        !result.postUrl && result.postId ? `post ID: ${result.postId}` : "",
        result.message ?? "",
        result.error ?? "",
      ]
        .filter(Boolean)
        .join(" — ");
      const threadResults =
        result.threadResults && result.threadResults.length > 0
          ? `\n${result.threadResults
              .map((segment) => {
                const segmentDetails = [
                  segment.postUrl ? `link: ${segment.postUrl}` : "",
                  !segment.postUrl && segment.postId ? `post ID: ${segment.postId}` : "",
                  segment.message ?? "",
                  segment.error ?? "",
                ]
                  .filter(Boolean)
                  .join(" — ");
                return `  - ${segment.index === 0 ? "Root post" : `Reply ${segment.index}`}: ${
                  segment.success ? "published" : "failed"
                }${segmentDetails ? ` (${segmentDetails})` : ""}`;
              })
              .join("\n")}`
          : "";

      return `- ${platformLabel(result.platform)} (account ID: ${result.accountId}): ${
        result.success ? "published" : "failed"
      }${details ? ` (${details})` : ""}${threadResults}`;
    })
    .join("\n")}`;
}

function formatCreatedPostDetails(result: {
  postingMode: string;
  mediaCount: number;
  post: { id: string; status: string; accountIds: string[]; scheduledFor: string | null; publishedAt: string | null };
  postingResults: Parameters<typeof formatPostingResults>[0];
  summary: {
    accountCount: number;
    threadSegmentCount: number;
    successCount: number;
    failureCount: number;
    scheduledCount: number;
    draftCount: number;
    overallSuccess: boolean;
  };
}): string {
  const { summary, post } = result;
  const outcome =
    result.postingMode === "draft"
      ? `Saved as a draft for ${plural(summary.accountCount, "account")}.`
      : result.postingMode === "schedule"
        ? `Scheduled for ${plural(summary.accountCount, "account")}.`
        : summary.failureCount === 0
          ? `Published to ${summary.accountCount === 1 ? "the account" : `all ${summary.accountCount} accounts`}.`
          : `Published to ${summary.successCount} of ${plural(summary.accountCount, "account")}; ${plural(
              summary.failureCount,
              "account",
            )} failed.`;

  return [
    "Post details:",
    `Post ID: ${post.id} (status: ${post.status})`,
    outcome,
    result.postingResults.length === 0 ? `Account IDs: ${post.accountIds.join(", ")}` : "",
    post.scheduledFor ? `Scheduled for: ${formatDateTime(post.scheduledFor)}` : "",
    post.publishedAt ? `Published at: ${formatDateTime(post.publishedAt)}` : "",
    result.mediaCount > 0 ? `Media: ${plural(result.mediaCount, "item")}` : "",
    summary.threadSegmentCount > 0
      ? `Thread: ${plural(summary.threadSegmentCount, "follow-up reply", "follow-up replies")}`
      : "",
    formatPostingResults(result.postingResults),
  ]
    .filter(Boolean)
    .join("\n");
}

function formatManagedPostDetails(post: {
  id: string;
  status: string;
  message: string;
  accountIds: string[];
  accounts: AccountSummary[];
  thread?: Array<{ message?: string }>;
  scheduledFor: string | null;
  publishedAt: string | null;
  mediaCount: number;
  threadSegmentCount: number;
  errorMessage: string | null;
}): string {
  return [
    `Post ${post.id} (${post.status})`,
    formatManagedPostContent(post),
    post.accounts.length > 0
      ? `Accounts: ${post.accounts.map((account) => formatAccount(account)).join("; ")}`
      : `Account IDs: ${post.accountIds.join(", ")}`,
    post.mediaCount > 0 ? `Media: ${plural(post.mediaCount, "item")}` : "",
    post.threadSegmentCount > 0
      ? `Thread: ${plural(post.threadSegmentCount, "follow-up reply", "follow-up replies")}`
      : "",
    post.scheduledFor ? `Scheduled for: ${formatDateTime(post.scheduledFor)}` : "",
    post.publishedAt ? `Published at: ${formatDateTime(post.publishedAt)}` : "",
    post.errorMessage ? `Last error: ${post.errorMessage}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatManagedPosts(posts: Array<Parameters<typeof formatManagedPostDetails>[0]>) {
  if (posts.length === 0) return "No posts matched — nothing drafted, scheduled, posted, or failed for this filter.";

  return posts.map((post, index) => `${index + 1}. ${formatManagedPostDetails(post)}`).join("\n\n");
}

/**
 * Register all SimplePost MCP tools on the given server instance.
 * The userId is bound to tool handlers so they operate on the authenticated user's data.
 */
export function registerTools(server: McpServer, context: McpToolAuthContext): void {
  registerAppTool(
    server,
    "list_accounts",
    {
      title: "List Connected Accounts",
      description: `List the social media accounts the authenticated user has connected to SimplePost. Call this first in any posting workflow. The returned accountId values are required by validate_post, preview_post, and create_post, and account IDs are not guessable.`,
      inputSchema: listAccountsSchema.shape,
      outputSchema: listAccountsOutputSchema.shape,
      annotations: MCP_TOOL_ANNOTATIONS.list_accounts,
      _meta: toolMeta("Checking your connected accounts", "Found your accounts"),
    },
    async () => {
      try {
        requireScope(context, "accounts:read");
        const result = await listAccounts(context.userId);
        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text:
                result.summary.total === 0
                  ? formatAccounts(result.accounts)
                  : `You have ${plural(result.summary.total, "connected account")} across ${plural(
                      result.summary.platforms.length,
                      "platform",
                    )}.\n\n${formatAccounts(result.accounts)}`,
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
    "upload_media",
    {
      title: "Upload Media",
      description: `Upload a ChatGPT generated or attached image/video file to SimplePost storage and get back a public URL you can pass into validate_post, preview_post, or create_post through the media field. This tool requires the file parameter; do not pass base64 media data. If the user already gave a fetchable URL, skip this tool and use the URL directly.`,
      inputSchema: uploadMediaSchema.shape,
      outputSchema: uploadMediaOutputSchema.shape,
      annotations: MCP_TOOL_ANNOTATIONS.upload_media,
      _meta: {
        ...toolMeta("Uploading your media", "Media uploaded"),
        "openai/fileParams": ["file"],
      },
    },
    async (input) => {
      try {
        requireScope(context, "posts:write");
        const result = await uploadMedia(context.userId, input);
        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text: [
                `Uploaded the ${result.type} ${result.filename} (${formatBytes(result.size)}, ${result.mimeType}).`,
                `URL: ${result.url}`,
                `Media item to attach to a post: {"type":"${result.type}","url":"${result.url}"}`,
              ].join("\n"),
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
    "validate_post",
    {
      title: "Validate Post",
      description: `Validate post text and optional media against the rules of each selected connected account without creating or publishing anything. Use this only when the user explicitly asks to validate, check, test, or troubleshoot a draft. Do not call it as a default preflight before create_post because create_post validates internally.`,
      inputSchema: validatePostSchema.shape,
      outputSchema: validatePostOutputSchema.shape,
      annotations: MCP_TOOL_ANNOTATIONS.validate_post,
      _meta: toolMeta("Checking your post", "Check complete"),
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
                ? `The post is good to go for ${plural(result.summary.accountCount, "account")}.\n\n${formatPostContent(
                    input.message,
                    input.thread,
                  )}\n\n${formatValidationDetails(result)}`
                : `The post has ${plural(
                    result.summary.errorCount,
                    "problem",
                  )} that would block publishing.\n\n${formatPostContent(
                    input.message,
                    input.thread,
                  )}\n\n${formatValidationDetails(result)}`,
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
      description: `Preview a post before it is created. This resolves target accounts, optional media count, optional thread segment count, scheduled time when applicable, and validation result without writing to SimplePost or publishing to social platforms. If scheduling, pass scheduledFor as a full ISO 8601 datetime with timezone (YYYY-MM-DDTHH:mm:ssZ or YYYY-MM-DDTHH:mm:ss+HH:mm, e.g. 2026-05-01T14:30:00Z). Draft previews do not need scheduledFor. Use it when the user explicitly asks for a preview or when essential posting details are missing; do not use it as a default preflight for already-confirmed posts.`,
      inputSchema: previewPostSchema.shape,
      outputSchema: previewPostOutputSchema.shape,
      annotations: MCP_TOOL_ANNOTATIONS.preview_post,
      _meta: toolMeta("Preparing a preview", "Preview ready"),
    },
    async (input) => {
      try {
        requireScope(context, "posts:validate");
        const result = await previewPost(context.userId, input);
        const summaryText = result.validation.isValid
          ? `Here's a preview for ${plural(result.summary.accountCount, "account")}${
              result.summary.mediaCount > 0 ? ` with ${plural(result.summary.mediaCount, "media item")}` : ""
            }${
              result.summary.threadSegmentCount > 0
                ? ` and ${plural(result.summary.threadSegmentCount, "follow-up reply", "follow-up replies")}`
                : ""
            }.\n\n${formatPostContent(input.message, input.thread)}`
          : `The preview found ${plural(
              result.summary.errorCount,
              "problem",
            )} that would block publishing.\n\n${formatPostContent(input.message, input.thread)}`;

        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text: `${summaryText}\n\n${formatPreviewDetails(result)}`,
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
      description: `Create a SimplePost post with text plus optional images/videos and optional multi-segment thread (thread field: follow-up messages after the root). Use postingMode "now" to publish immediately, "schedule" with a future scheduledFor in full ISO 8601 format with timezone (YYYY-MM-DDTHH:mm:ssZ or YYYY-MM-DDTHH:mm:ss+HH:mm, e.g. 2026-05-01T14:30:00Z), or "draft" to save without publishing. Do not send date-only or local time without timezone when scheduling. This is a write action that can publish public content on connected social platforms and it performs blocking validation internally for now/schedule, so do not call validate_post first unless the user requested validation-only feedback. Always call list_accounts first to get account IDs.`,
      inputSchema: createPostSchema.shape,
      outputSchema: createPostOutputSchema.shape,
      annotations: MCP_TOOL_ANNOTATIONS.create_post,
      _meta: toolMeta("Working on your post", "Finished working on your post"),
    },
    async (input) => {
      try {
        requireScope(context, "posts:write");
        const result = await createPost(context.userId, input);
        const threadSuffix =
          result.summary.threadSegmentCount > 0
            ? ` with ${plural(result.summary.threadSegmentCount, "follow-up reply", "follow-up replies")}`
            : "";
        const summaryText =
          result.post.status === "draft"
            ? `Saved the post as a draft for ${plural(result.summary.draftCount, "account")}${threadSuffix}.\n\n${formatPostContent(input.message, input.thread)}`
            : result.post.status === "scheduled"
              ? `Scheduled the post for ${formatDateTime(result.post.scheduledFor ?? "")} on ${plural(
                  result.summary.scheduledCount,
                  "account",
                )}${threadSuffix}.\n\n${formatPostContent(input.message, input.thread)}`
              : result.summary.overallSuccess
                ? `Published the post to ${plural(
                    result.summary.successCount,
                    "account",
                  )}${threadSuffix ? `${threadSuffix} on thread-capable accounts` : ""}.\n\n${formatPostContent(input.message, input.thread)}`
                : `Published to ${result.summary.successCount} of ${plural(
                    result.summary.accountCount,
                    "account",
                  )} — ${plural(result.summary.failureCount, "account")} failed; see the posting results below.\n\n${formatPostContent(input.message, input.thread)}`;

        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text: `${summaryText}\n\n${formatCreatedPostDetails(result)}`,
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
    "inspect_posts",
    {
      title: "Inspect Posts",
      description: `Use this when the user asks to review SimplePost posts that are drafts, currently scheduled, already posted, or failed. It can list posts by status or inspect a specific postId before editing or discarding a draft or scheduled post. This tool only reads SimplePost data and does not publish, edit, or delete anything.`,
      inputSchema: inspectPostsSchema.shape,
      outputSchema: inspectPostsOutputSchema.shape,
      annotations: MCP_TOOL_ANNOTATIONS.inspect_posts,
      _meta: toolMeta("Looking up your posts", "Found your posts"),
    },
    async (input) => {
      try {
        requireScope(context, "posts:read");
        const result = await inspectPosts(context.userId, input);
        const statusBreakdown = [
          result.summary.draftCount > 0 ? plural(result.summary.draftCount, "draft") : "",
          result.summary.scheduledCount > 0 ? `${result.summary.scheduledCount} scheduled` : "",
          result.summary.postedCount > 0 ? `${result.summary.postedCount} posted` : "",
          result.summary.failedCount > 0 ? `${result.summary.failedCount} failed` : "",
        ]
          .filter(Boolean)
          .join(", ");
        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text:
                result.status === "single"
                  ? result.posts.length > 0
                    ? `Found the post (${result.posts[0].status}).\n\n${formatManagedPostDetails(result.posts[0])}`
                    : "Couldn't find that post — it may have been deleted."
                  : result.summary.totalReturned === 0
                    ? formatManagedPosts(result.posts)
                    : `Found ${plural(result.summary.totalReturned, "post")}${
                        statusBreakdown ? ` (${statusBreakdown})` : ""
                      }.\n\n${formatManagedPosts(result.posts)}`,
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
    "update_scheduled_post",
    {
      title: "Update Scheduled Post",
      description: `Use this when the user asks to edit a draft or future scheduled SimplePost post. Provide the postId from inspect_posts and only the fields that should change: message, accountIds, media, thread, postingMode, or scheduledFor. Set postingMode to "draft" to move a scheduled post to drafts, or "schedule" with scheduledFor to move a draft to scheduled. This validates the final scheduled post before saving and cannot edit already posted, failed, pending, or due posts.`,
      inputSchema: updateScheduledPostSchema.shape,
      outputSchema: updateScheduledPostOutputSchema.shape,
      annotations: MCP_TOOL_ANNOTATIONS.update_scheduled_post,
      _meta: toolMeta("Updating your post", "Post updated"),
    },
    async (input) => {
      try {
        requireScope(context, "posts:write");
        const result = await updateScheduledPost(context.userId, input);
        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text:
                result.post.status === "draft"
                  ? `Updated the draft.\n\n${formatManagedPostDetails(result.post)}\n\n${formatValidationDetails(
                      result.validation,
                    )}`
                  : `Updated the post — it's now scheduled for ${formatDateTime(
                      result.post.scheduledFor ?? "",
                    )}.\n\n${formatManagedPostDetails(result.post)}\n\n${formatValidationDetails(result.validation)}`,
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
    "discard_scheduled_post",
    {
      title: "Discard Scheduled Post",
      description: `Use this when the user asks to cancel, delete, or discard a draft or future scheduled SimplePost post. Provide the postId from inspect_posts. This permanently deletes the SimplePost record and stored media, and it cannot undo content that has already been posted to social platforms.`,
      inputSchema: discardScheduledPostSchema.shape,
      outputSchema: discardScheduledPostOutputSchema.shape,
      annotations: MCP_TOOL_ANNOTATIONS.discard_scheduled_post,
      _meta: toolMeta("Deleting your post", "Post deleted"),
    },
    async (input) => {
      try {
        requireScope(context, "posts:write");
        const result = await discardScheduledPost(context.userId, input);
        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text: `Deleted the ${
                result.post.status === "draft" ? "draft" : "scheduled post"
              } — it will not be published.\n\n${formatManagedPostDetails(
                result.post,
              )}\n\nNote: this only removes drafts and upcoming scheduled posts from SimplePost; posts already published to social platforms can't be taken back this way.`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
