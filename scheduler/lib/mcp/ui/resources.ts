import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

import { getAppBaseUrl } from "@/lib/mcp/config";
import { WIDGET_ASSETS, type WidgetName } from "@/lib/mcp/ui/widget-assets";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const SCHEDULE_WIDGET_URI = "ui://simplepost/schedule-v2.html";
const POST_PREVIEW_WIDGET_VERSION = "2";
export const POST_PREVIEW_WIDGET_URI = `ui://simplepost/post-preview-v${POST_PREVIEW_WIDGET_VERSION}.html`;

const SOCIAL_MEDIA_RESOURCE_DOMAINS = [
  "https://*.simplepost.social",

  // X
  "https://pbs.twimg.com",

  // LinkedIn
  "https://media.licdn.com",
  "https://media.licdn-ei.com",

  // Facebook, Instagram, and Threads
  "https://*.fbcdn.net",
  "https://*.fbsbx.com",
  "https://*.cdninstagram.com",

  // YouTube / Google profiles
  "https://*.googleusercontent.com",
  "https://*.ggpht.com",
  "https://*.ytimg.com",

  // TikTok
  "https://*.tiktokcdn.com",
  "https://*.tiktokcdn-us.com",

  // Bluesky
  "https://cdn.bsky.app",

  // Pinterest
  "https://*.pinimg.com",

  // DEV and the default Forem image CDN
  "https://dev.to",
  "https://*.dev.to",
  "https://res.cloudinary.com",
];

function widgetHtml(name: WidgetName): string {
  const baseUrl = getAppBaseUrl();
  const assets = WIDGET_ASSETS[name];
  const scriptUrl = new URL(`/mcp-widgets/${assets.script}`, `${baseUrl}/`);
  const stylesheetUrl = new URL(`/mcp-widgets/${assets.stylesheet}`, `${baseUrl}/`);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="simplepost-base-url" content="${baseUrl}" />
    <link rel="stylesheet" href="${stylesheetUrl.toString()}" />
    <title>SimplePost</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${scriptUrl.toString()}"></script>
  </body>
</html>`;
}

function resourceDomains(): string[] {
  return [...new Set([widgetOrigin(), ...SOCIAL_MEDIA_RESOURCE_DOMAINS])];
}

function widgetOrigin(): string {
  return new URL(getAppBaseUrl()).origin;
}

function widgetUiMeta() {
  return {
    domain: widgetOrigin(),
    prefersBorder: true,
    csp: {
      resourceDomains: resourceDomains(),
    },
  };
}

function openAiWidgetCspMeta() {
  return {
    connect_domains: [],
    resource_domains: resourceDomains(),
  };
}

export function registerMcpUiResources(server: McpServer): void {
  registerAppResource(
    server,
    "SimplePost schedule",
    SCHEDULE_WIDGET_URI,
    {
      description: "Interactive day, week, and month view of posting slots and post activity.",
      _meta: {
        ui: widgetUiMeta(),
        "openai/widgetCSP": openAiWidgetCspMeta(),
        "openai/widgetDomain": widgetOrigin(),
      },
    },
    async () => ({
      contents: [
        {
          uri: SCHEDULE_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml("schedule"),
          _meta: {
            ui: widgetUiMeta(),
            "openai/widgetDescription":
              "Interactive SimplePost schedule with day, week, and month views, posting slots, and post statuses.",
            "openai/widgetCSP": openAiWidgetCspMeta(),
            "openai/widgetDomain": widgetOrigin(),
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
        ui: widgetUiMeta(),
        "openai/widgetCSP": openAiWidgetCspMeta(),
        "openai/widgetDomain": widgetOrigin(),
      },
    },
    async () => ({
      contents: [
        {
          uri: POST_PREVIEW_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml("post-preview"),
          _meta: {
            ui: widgetUiMeta(),
            "openai/widgetDescription":
              "Realistic SimplePost platform previews with a switcher for every selected social platform.",
            "openai/widgetCSP": openAiWidgetCspMeta(),
            "openai/widgetDomain": widgetOrigin(),
            "openai/widgetPrefersBorder": true,
          },
        },
      ],
    }),
  );
}
