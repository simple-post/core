import { z } from "zod";

import type { ConnectedAccount, SocialPost } from "@/types";

// Browser-only adapter: use the same authenticated HTTP endpoints as the form,
// never import the Node-only MCP server or SDK publisher barrel here.
const mediaSchema = z.object({
  url: z
    .url({ protocol: /^https?$/ })
    .describe("Public HTTP(S) media URL supplied by the user or an upload result; not a local file or blob URL."),
  type: z.enum(["image", "video"]),
  id: z.string().optional(),
  filename: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  durationSec: z.number().nonnegative().optional(),
  thumbnailUrl: z.url({ protocol: /^https?$/ }).optional(),
});
const threadSchema = z.array(z.object({ message: z.string(), media: z.array(mediaSchema).optional() })).max(24);
const contentSchema = z.object({
  message: z.string(),
  accountIds: z
    .array(z.string().min(1))
    .min(1)
    .describe("Use actual connected account IDs from list_accounts. Ask which account to use if ambiguous."),
  media: z.array(mediaSchema).optional(),
  thread: threadSchema.optional(),
  accountOverrides: z
    .record(
      z.string(),
      z.object({
        message: z.string().optional(),
        media: z.array(mediaSchema).optional(),
        thread: threadSchema.optional(),
      }),
    )
    .optional()
    .describe(
      "Platform-specific text, media, or threads keyed by connected account ID. Omitted fields inherit the root content.",
    ),
  accountOptions: z
    .record(z.string(), z.record(z.string(), z.unknown()))
    .optional()
    .describe(
      "Platform settings keyed by account ID, e.g. YouTube title, privacyStatus and selfDeclaredMadeForKids, Pinterest boardId, or Forem title. TikTok supports autoAddMusic (photo Direct Post only), photoCoverIndex, title, description, and publishMode: draft to upload to the TikTok inbox for manual music/editing/publishing. Use postingMode: now to run the inbox upload; postingMode: draft only saves in SimplePost. validate_post reports missing requirements.",
    ),
});
const createSchema = contentSchema
  .extend({
    postingMode: z
      .enum(["draft", "schedule", "now"])
      .describe("Required explicit intent: draft saves only, schedule publishes later, now publishes immediately."),
    scheduledFor: z.iso
      .datetime({ offset: true })
      .optional()
      .describe("For schedule: future ISO 8601 datetime including timezone. Resolve ambiguous times with the user."),
    idempotencyKey: z
      .string()
      .min(1)
      .max(255)
      .describe(
        "Unique key per logical post. Reuse EXACTLY this key and content on retries after an uncertain response; use a new key only for a new post.",
      ),
    userConfirmed: z
      .literal(true)
      .describe(
        "Set true only when the user's request authorizes this content, target accounts, posting mode and time. A request to preview or edit does not authorize publishing.",
      ),
  })
  .strict();

export interface WebMcpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (input: unknown) => Promise<unknown>;
}

export interface ModelContext {
  registerTool: (tool: WebMcpTool, options: { signal: AbortSignal }) => void | Promise<void>;
}

export interface CreatedPostResult {
  post: SocialPost;
  postingResults?: Array<{ accountId: string; success: boolean; error?: string; postUrl?: string }>;
  replayed?: boolean;
}

type ToolDependencies = {
  fetch: typeof fetch;
  onCreated: (result: CreatedPostResult) => void;
};

function normalizeMedia(items: z.infer<typeof mediaSchema>[] | undefined) {
  return items?.map((item) => ({
    ...item,
    id: item.id ?? crypto.randomUUID(),
    filename: item.filename ?? (new URL(item.url).pathname.split("/").pop() || "media"),
    size: item.size ?? 0,
  }));
}

function normalizeThread(items: z.infer<typeof threadSchema> | undefined) {
  return items?.map((item) => ({ ...item, media: normalizeMedia(item.media) }));
}

function normalizeContent(input: z.infer<typeof contentSchema>) {
  return {
    ...input,
    accountIds: [...new Set(input.accountIds)],
    media: normalizeMedia(input.media) ?? [],
    thread: normalizeThread(input.thread),
    accountOverrides:
      input.accountOverrides &&
      Object.fromEntries(
        Object.entries(input.accountOverrides).map(([id, override]) => [
          id,
          {
            ...override,
            media: normalizeMedia(override.media),
            thread: normalizeThread(override.thread),
          },
        ]),
      ),
  };
}

export function createPostTools(dependencies: ToolDependencies): WebMcpTool[] {
  async function request<T>(path: string, body?: unknown): Promise<T> {
    const response = await dependencies.fetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = typeof data?.error === "string" ? data.error : `SimplePost request failed (${response.status}).`;
      throw new Error(message);
    }
    if (!data)
      throw new Error(
        "No result received. If creating a post, retry with the same idempotencyKey; do not submit the form as a fallback.",
      );
    return data as T;
  }

  const accounts = () => request<{ accounts: ConnectedAccount[] }>("/api/v1/accounts");
  const postIdSchema = z.object({ postId: z.string().min(1) }).strict();

  return [
    {
      name: "list_accounts",
      title: "List connected SimplePost accounts",
      description:
        "Start here to create posts on this page using WebMCP instead of clicking or filling the form. Returns account IDs and identities, current time and timezone. Next call validate_post, then create_post with the user's authorized intent. No API key is needed; these tools use the signed-in session.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, idempotentHint: true, untrustedContentHint: true },
      execute: async () => {
        const connected = await accounts();
        return {
          accounts: connected.accounts.map((account) => ({
            id: account.id,
            platform: account.platform,
            displayName: account.displayName,
            username: account.username,
            previewOnly: account.previewOnly ?? false,
            credentialStatus: account.credentialStatus,
          })),
          currentTime: new Date().toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
      },
    },
    {
      name: "validate_post",
      title: "Validate a post without saving",
      description:
        "Check text, media, thread and per-account variants against platform rules before creating. Returns validation errors and warnings. Does not save, schedule, publish, or change the form. Use the same content with create_post after resolving errors.",
      inputSchema: z.toJSONSchema(contentSchema, { io: "input" }),
      annotations: { readOnlyHint: true, idempotentHint: true, untrustedContentHint: true },
      execute: async (raw) => request("/api/v1/validation", normalizeContent(contentSchema.parse(raw))),
    },
    {
      name: "create_post",
      title: "Create, schedule, or publish a SimplePost post",
      description:
        "Create directly through WebMCP, not the form. First list_accounts and validate_post. Requires explicit postingMode, user authorization and an idempotencyKey. Draft saves only; schedule and now can publish publicly and consume posting allowance. Supports per-account variants, media and threads. Returns the saved post and individual publishing results: report partial failures honestly. On timeout or network error, retry only with the SAME idempotencyKey and content, never by clicking Submit. Does not clear or submit any existing manual form draft. TikTok non-draft posting requires the user's manual consent flow and is not supported by this tool.",
      inputSchema: z.toJSONSchema(createSchema, { io: "input" }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      execute: async (raw) => {
        const {
          userConfirmed: _userConfirmed,
          postingMode,
          scheduledFor,
          idempotencyKey,
          ...content
        } = createSchema.parse(raw);
        if (postingMode === "schedule" && (!scheduledFor || Date.parse(scheduledFor) <= Date.now())) {
          throw new Error("Scheduling requires a future scheduledFor with an explicit timezone.");
        }
        const { accounts: connected } = await accounts();
        const selected = content.accountIds.map((id) => {
          const account = connected.find((candidate) => candidate.id === id);
          if (!account) throw new Error(`Account ${id} is not connected. Call list_accounts again.`);
          return account;
        });
        if (postingMode !== "draft" && selected.some((account) => account.platform.toLowerCase() === "tiktok")) {
          throw new Error(
            "TikTok publishing requires the user to review platform settings and give consent in the form. You may save a draft with WebMCP; do not automate that consent.",
          );
        }
        const body = {
          ...normalizeContent(content),
          postingMode,
          scheduledFor: postingMode === "schedule" ? new Date(scheduledFor!).toISOString() : undefined,
          idempotencyKey,
        };
        const result = await request<CreatedPostResult>("/api/v1/posts", body);
        // UI refresh failures must not turn a successful write into an apparent failure.
        try {
          dependencies.onCreated(result);
        } catch (error) {
          console.warn("Post created, but the page could not refresh", error);
        }
        return result;
      },
    },
    {
      name: "get_post",
      title: "Read a created post",
      description:
        "Verify a post's saved status and per-account results using its actual ID returned by create_post. Read-only. Do not infer that creation means every platform published successfully.",
      inputSchema: z.toJSONSchema(postIdSchema),
      annotations: { readOnlyHint: true, idempotentHint: true, untrustedContentHint: true },
      execute: async (raw) => {
        const { postId } = postIdSchema.parse(raw);
        return request(`/api/v1/posts/${encodeURIComponent(postId)}`);
      },
    },
  ];
}

export async function registerCreatePostTools(context: ModelContext, tools: WebMcpTool[], signal: AbortSignal) {
  await Promise.all(tools.map((tool) => context.registerTool(tool, { signal })));
}
