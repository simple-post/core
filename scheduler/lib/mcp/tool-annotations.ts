import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export const MCP_TOOL_HINT_KEYS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const;

export type McpToolHintKey = (typeof MCP_TOOL_HINT_KEYS)[number];

export const MCP_TOOL_ANNOTATIONS = {
  list_accounts: {
    title: "List connected SimplePost accounts",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  upload_media: {
    title: "Upload media to SimplePost",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  validate_post: {
    title: "Validate a SimplePost draft",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  preview_post: {
    title: "Preview a SimplePost draft",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  create_post: {
    title: "Create or publish a SimplePost post",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  inspect_posts: {
    title: "Inspect SimplePost posts",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  update_scheduled_post: {
    title: "Update a scheduled SimplePost post",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  discard_scheduled_post: {
    title: "Discard a scheduled SimplePost post",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
} as const satisfies Record<string, ToolAnnotations>;

export type McpToolName = keyof typeof MCP_TOOL_ANNOTATIONS;
