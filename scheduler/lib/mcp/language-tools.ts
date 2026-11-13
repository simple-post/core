import { z } from "zod";

import { serverT } from "@/lib/i18n/server";
import { savedPluginLanguage, savePluginLanguage, pluginLanguageSchema } from "@/lib/preferences/plugin-language";

import { hasMcpScope } from "./config";
import { mcpUiTranslation } from "./locale";
import { registerMeasuredTool } from "./registration";

import type { McpToolAuthContext } from "./server";
import type { McpServer } from "@modelcontextprotocol/server";

export function registerLanguageTools(server: McpServer, context: McpToolAuthContext) {
  const result = (data: Record<string, unknown>) => ({
    structuredContent: data,
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  });
  const meta = (scope: "posts:read" | "posts:write") => ({
    securitySchemes: [{ type: "oauth2", scopes: [scope] }],
    ui: { visibility: ["model", "app"] },
    "openai/widgetAccessible": true,
  });
  registerMeasuredTool(
    context,
    server,
    "get_language_settings",
    {
      title: "Language",
      description: "Read the plugin language setting. Automatic follows the connected client.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      _meta: meta("posts:read"),
    },
    async () => {
      if (!hasMcpScope(context.scope, "posts:read"))
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: serverT("Reconnect SimplePost to approve the required access ({{scope}}).", {
                scope: "posts:read",
              }),
            },
          ],
        };
      return result({
        language: (await savedPluginLanguage(context.userId)) ?? "auto",
        resolvedLocale: mcpUiTranslation().locale,
      });
    },
  );
  registerMeasuredTool(
    context,
    server,
    "set_plugin_language",
    {
      title: "Language",
      description:
        "Save the plugin language when the user requests it. Use auto to follow the connected client. User content is unchanged.",
      inputSchema: z.object({ language: pluginLanguageSchema }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      _meta: meta("posts:write"),
    },
    async ({ language }) => {
      if (!hasMcpScope(context.scope, "posts:write"))
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: serverT("Reconnect SimplePost to approve the required access ({{scope}}).", {
                scope: "posts:write",
              }),
            },
          ],
        };
      return result({ language: await savePluginLanguage(context.userId, language) });
    },
  );
}
