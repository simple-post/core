import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

import { getAppBaseUrl } from "@/lib/mcp/config";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const SCHEDULE_WIDGET_URI = "ui://simplepost/schedule-v2.html";
export const POST_PREVIEW_WIDGET_URI = "ui://simplepost/post-preview-v2.html";

const SOCIAL_MEDIA_RESOURCE_DOMAINS = [
  "https://*.simplepost.social",
  "https://pbs.twimg.com",
  "https://media.licdn.com",
  "https://*.fbcdn.net",
  "https://*.cdninstagram.com",
  "https://*.googleusercontent.com",
  "https://*.ytimg.com",
  "https://*.tiktokcdn.com",
  "https://cdn.bsky.app",
];

function widgetHtml(name: string): string {
  const baseUrl = getAppBaseUrl();
  const scriptUrl = new URL(`/mcp-widgets/${name}.js`, `${baseUrl}/`).toString();
  const stylesheetUrl = new URL(`/mcp-widgets/${name}.css`, `${baseUrl}/`).toString();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${stylesheetUrl}" />
    <title>SimplePost</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${scriptUrl}"></script>
  </body>
</html>`;
}

function resourceDomains(): string[] {
  const appOrigin = new URL(getAppBaseUrl()).origin;
  return [...new Set([appOrigin, ...SOCIAL_MEDIA_RESOURCE_DOMAINS])];
}

export function registerMcpUiResources(server: McpServer): void {
  registerAppResource(
    server,
    "SimplePost schedule",
    SCHEDULE_WIDGET_URI,
    {
      description: "Interactive day, week, and month view of posting slots and post activity.",
      _meta: {
        ui: {
          prefersBorder: true,
          csp: {
            resourceDomains: resourceDomains(),
          },
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: SCHEDULE_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml("schedule"),
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                resourceDomains: resourceDomains(),
              },
            },
            "openai/widgetDescription":
              "Interactive SimplePost schedule with day, week, and month views, posting slots, and post statuses.",
            "openai/widgetPrefersBorder": true,
          },
        },
      ],
    }),
  );

  registerAppResource(
    server,
    "SimplePost post preview",
    POST_PREVIEW_WIDGET_URI,
    {
      description: "Interactive platform switcher with realistic social post previews.",
      _meta: {
        ui: {
          prefersBorder: true,
          csp: {
            resourceDomains: resourceDomains(),
          },
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: POST_PREVIEW_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml("post-preview"),
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                resourceDomains: resourceDomains(),
              },
            },
            "openai/widgetDescription":
              "Realistic SimplePost platform previews with a switcher for every selected social platform.",
            "openai/widgetPrefersBorder": true,
          },
        },
      ],
    }),
  );
}
