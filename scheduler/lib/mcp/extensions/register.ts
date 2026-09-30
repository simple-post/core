import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { type McpServer } from "@modelcontextprotocol/server";
import { Feature } from "@prisma/client";
import { z } from "zod";

import { hasFeature } from "@/lib/features";
import { getAppBaseUrl, hasMcpScope, type McpScope } from "@/lib/mcp/config";
import type { McpToolAuthContext } from "@/lib/mcp/server";
import { WORKSPACE_WIDGET_URI, EDITOR_WIDGET_URI } from "@/lib/mcp/ui/resources";
import {
  publishingSettingsSchema,
  readPublishingPreferences,
  updatePublishingPreferences,
} from "@/lib/preferences/publishing";
import { ForbiddenError } from "@/lib/utils/errors";

import { proposalSchema, sessionCommitSchema, sessionUpdateSchema, sessionVersionSchema } from "./contracts";
import { EXTENSION_TOOL_ANNOTATIONS } from "./tool-annotations";
import { EXTENSION_TOOL_DESCRIPTIONS } from "./tool-descriptions";
import {
  commitEditor,
  loadWorkspace,
  proposeEdit,
  readEditor,
  startEditor,
  updateEditor,
  validateEditor,
  workspaceInputSchema,
} from "./workspace";

type ErrorResult = (
  error: unknown,
  context: McpToolAuthContext,
) => { content: Array<{ type: "text"; text: string }>; isError: boolean; _meta: Record<string, unknown> };

export function registerExtensionTools(server: McpServer, context: McpToolAuthContext, errorResult: ErrorResult) {
  // ext-apps forwards icons, though its compatibility config type omits them.
  const toolIcons = { icons: [{ src: `${getAppBaseUrl()}/simplepost-sidebar.svg`, mimeType: "image/svg+xml" }] };
  const meta = {
    securitySchemes: [{ type: "oauth2", scopes: ["accounts:read", "posts:read", "posts:validate", "posts:write"] }],
    ui: { visibility: ["model", "app"] },
  };
  async function guard(scopes: McpScope[]) {
    if (!(await hasFeature(context.userId, Feature.PLUGIN_EXTENSIONS)))
      throw new ForbiddenError(
        "The SimplePost workspace is currently unavailable. Existing posting tools remain available.",
      );
    for (const scope of scopes)
      if (!hasMcpScope(context.scope, scope))
        throw new ForbiddenError(`Reconnect SimplePost to approve the required access (${scope}).`);
  }
  function tool<S extends z.ZodObject>(
    name: keyof typeof EXTENSION_TOOL_ANNOTATIONS,
    title: string,
    schema: S,
    scopes: McpScope[],
    handler: (input: z.infer<S>) => Promise<unknown>,
    extraMeta: Record<string, unknown> = {},
    outputSchema?: z.ZodObject,
  ) {
    registerAppTool(
      server,
      name,
      {
        title,
        description: EXTENSION_TOOL_DESCRIPTIONS[name],
        inputSchema: schema.shape,
        ...(outputSchema ? { outputSchema } : {}),
        annotations: EXTENSION_TOOL_ANNOTATIONS[name],
        ...toolIcons,
        _meta: { ...meta, securitySchemes: [{ type: "oauth2", scopes }], ...extraMeta },
      },
      async (input) => {
        try {
          await guard(scopes);
          const result = await handler(schema.parse(input));

          return {
            // eslint-disable-next-line unicorn/prefer-structured-clone -- Normalize Dates and undefined for MCP JSON.
            structuredContent: JSON.parse(JSON.stringify(result)) as Record<string, unknown>,
            content: [{ type: "text" as const, text: `${title}: ${JSON.stringify(result)}` }],
          };
        } catch (error) {
          return errorResult(error, context);
        }
      },
    );
  }
  const workspace = async (input: z.infer<typeof workspaceInputSchema>) => ({
    ...(await loadWorkspace(context.userId, input)),
    accountsUrl: `${getAppBaseUrl()}/accounts?onboarding=connect`,
    canWrite: hasMcpScope(context.scope, "posts:write"),
    canValidate: hasMcpScope(context.scope, "posts:validate"),
    imageFittingEnabled: await hasFeature(context.userId, Feature.IMAGE_FITTING),
  });
  const openerMeta = (uri: string, type: "global" | "thread") => ({
    ui: { resourceUri: uri, visibility: ["model", "app"] },
    "openai/outputTemplate": uri,
    "openai/ui": { entrypoints: [{ type }] },
  });
  tool(
    "open_simplepost_workspace",
    "SimplePost",
    workspaceInputSchema,
    ["posts:read", "accounts:read"],
    workspace,
    openerMeta(WORKSPACE_WIDGET_URI, "global"),
  );
  tool(
    "get_simplepost_workspace",
    "Refresh the publishing workspace",
    workspaceInputSchema,
    ["posts:read", "accounts:read"],
    workspace,
  );
  tool(
    "open_post_editor",
    "Post editor",
    z.object({ postId: z.string().optional() }),
    ["posts:read", "accounts:read"],
    async ({ postId }) => ({
      ...(await workspace(workspaceInputSchema.parse({}))),
      requestedPostId: postId ?? null,
      kind: "editor_launch",
    }),
    openerMeta(EDITOR_WIDGET_URI, "thread"),
  );
  tool(
    "start_post_editor_session",
    "Start a working copy",
    z.object({ postId: z.string().optional() }),
    ["posts:read", "accounts:read", "posts:write"],
    ({ postId }) => startEditor(context.userId, postId),
  );
  tool(
    "read_post_editor_session",
    "Read a working copy",
    z.object({ sessionId: z.string().uuid() }),
    ["posts:read"],
    ({ sessionId }) => readEditor(context.userId, sessionId),
  );
  tool("update_post_editor_session", "Keep editor changes", sessionUpdateSchema, ["posts:write"], (input) =>
    updateEditor(context.userId, input),
  );
  tool(
    "propose_post_edit",
    "Propose writing changes to the selected editor",
    proposalSchema,
    ["posts:read", "posts:write"],
    (input) => proposeEdit(context.userId, input),
  );
  tool(
    "commit_post_editor_session",
    "Save, schedule or publish the reviewed editor",
    sessionCommitSchema,
    ["posts:read", "posts:write", "posts:validate"],
    (input) => commitEditor(context.userId, input),
  );
  tool(
    "validate_post_editor_session",
    "Check the current editor against platform rules",
    sessionVersionSchema.extend({ imageFit: z.enum(["crop", "blur"]).optional() }),
    ["posts:read", "posts:validate"],
    ({ sessionId, expectedRevision, imageFit }) =>
      validateEditor(context.userId, sessionId, expectedRevision, imageFit),
  );
  tool(
    "read_simplepost_settings",
    "Read publishing preferences",
    z.object({}),
    ["posts:read"],
    async () => {
      const preferences = await readPublishingPreferences(context.userId);
      return {
        schema: {
          type: "object",
          properties: {
            timeZone: {
              type: "string",
              title: "Timezone",
              description: "IANA timezone, for example Europe/Berlin. Existing scheduled instants are unchanged.",
            },
            calendarView: { type: "string", title: "Calendar view", enum: ["day", "week", "month"] },
          },
        },
        values: { timeZone: preferences.timeZone, calendarView: preferences.calendarView },
      };
    },
    { ui: { visibility: ["app"] } },
    z.object({ schema: z.record(z.string(), z.unknown()), values: z.record(z.string(), z.unknown()) }),
  );
  tool(
    "update_simplepost_settings",
    "Update publishing preferences",
    z.object({ set: publishingSettingsSchema }),
    ["posts:write"],
    async ({ set }) => ({ values: await updatePublishingPreferences(context.userId, set) }),
    { ui: { visibility: ["model", "app"] } },
  );
  server.server.registerCapabilities({
    extensions: {
      "openai/settings": { readTool: "read_simplepost_settings", updateTool: "update_simplepost_settings" },
    },
  });
}
