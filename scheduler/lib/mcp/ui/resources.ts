import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

import { getAppBaseUrl } from "@/lib/mcp/config";
import { WIDGET_RUNTIME_PATH, WIDGET_RUNTIME_TIMEOUT_MS } from "@/lib/mcp/ui/runtime";
import type { WidgetName } from "@/lib/mcp/ui/widget-assets";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const SCHEDULE_WIDGET_URI = "ui://simplepost/schedule-v2.html";
export const LEGACY_SCHEDULE_WIDGET_URIS = ["ui://simplepost/schedule-v1.html"] as const;
const POST_PREVIEW_WIDGET_VERSION = "1";
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
  "https://*.tiktokcdn-eu.com",

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
  const runtimeUrl = new URL(WIDGET_RUNTIME_PATH, `${baseUrl}/`);
  runtimeUrl.searchParams.set("mode", name);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="simplepost-base-url" content="${baseUrl}" />
    <title>SimplePost</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; min-height: 96px; }
      .simplepost-bootstrap { align-items: center; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; justify-content: center; min-height: 96px; padding: 20px; text-align: center; }
      .simplepost-bootstrap p { margin: 0; }
      .simplepost-bootstrap button { background: #111827; border: 0; border-radius: 8px; color: #fff; cursor: pointer; font: inherit; padding: 8px 14px; }
      @media (prefers-color-scheme: dark) { .simplepost-bootstrap button { background: #f9fafb; color: #111827; } }
    </style>
  </head>
  <body>
    <div id="root"><div class="simplepost-bootstrap" role="status"><p>Loading SimplePost…</p></div></div>
    <script>
      (function () {
        var root = document.getElementById("root");
        var runtimeUrl = ${JSON.stringify(runtimeUrl.toString())};
        var runtimeStateKey = "__simplepostRuntimeMount";
        var activeScript = null;
        var timeoutId = null;

        function clearAttempt() {
          if (timeoutId !== null) window.clearTimeout(timeoutId);
          timeoutId = null;
          if (activeScript) activeScript.remove();
          activeScript = null;
        }

        function showLoading() {
          root.innerHTML = '<div class="simplepost-bootstrap" role="status"><p>Loading SimplePost…</p></div>';
        }

        function showFailure(message) {
          window[runtimeStateKey] = "";
          clearAttempt();
          root.innerHTML = '<div class="simplepost-bootstrap" role="alert"><p></p><button type="button">Retry</button></div>';
          root.querySelector("p").textContent = message || "Unable to load SimplePost.";
          root.querySelector("button").addEventListener("click", loadRuntime);
        }

        function loadRuntime() {
          clearAttempt();
          showLoading();
          var mountId = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
          window[runtimeStateKey] = mountId;
          var script = document.createElement("script");
          activeScript = script;
          script.type = "module";
          script.src = runtimeUrl + "&mount=" + encodeURIComponent(mountId);
          script.addEventListener("load", function () {
            if (activeScript !== script) return;
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            timeoutId = null;
          }, { once: true });
          script.addEventListener("error", function () {
            if (activeScript === script) showFailure("Unable to load SimplePost. Please try again.");
          }, { once: true });
          timeoutId = window.setTimeout(function () {
            if (activeScript === script) showFailure("SimplePost took too long to load. Please try again.");
          }, ${WIDGET_RUNTIME_TIMEOUT_MS});
          document.head.appendChild(script);
        }

        window.addEventListener("simplepost:runtime-error", function (event) {
          var detail = event.detail || {};
          if (detail.mount === window[runtimeStateKey]) showFailure(detail.message);
        });

        loadRuntime();
      })();
    </script>
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
    prefersBorder: true,
    csp: {
      resourceDomains: resourceDomains(),
    },
  };
}

type WidgetResourceOptions = {
  description: string;
  name: string;
  uri: string;
  widgetDescription: string;
  widgetName: WidgetName;
};

function registerWidgetResource(server: McpServer, options: WidgetResourceOptions): void {
  registerAppResource(
    server,
    options.name,
    options.uri,
    {
      description: options.description,
      _meta: {
        ui: widgetUiMeta(),
        "openai/widgetDomain": widgetOrigin(),
      },
    },
    async (requestedUri) => ({
      contents: [
        {
          uri: requestedUri.toString(),
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml(options.widgetName),
          _meta: {
            ui: widgetUiMeta(),
            "openai/widgetDescription": options.widgetDescription,
            "openai/widgetDomain": widgetOrigin(),
            "openai/widgetPrefersBorder": true,
          },
        },
      ],
    }),
  );
}

export function registerMcpUiResources(server: McpServer): void {
  const scheduleOptions = {
    description: "Interactive day, week, and month view of posting slots and post activity.",
    name: "SimplePost schedule",
    widgetDescription:
      "Interactive SimplePost schedule with day, week, and month views, posting slots, and post statuses.",
    widgetName: "schedule",
  } as const;

  registerWidgetResource(server, { ...scheduleOptions, uri: SCHEDULE_WIDGET_URI });
  for (const uri of LEGACY_SCHEDULE_WIDGET_URIS) {
    registerWidgetResource(server, { ...scheduleOptions, name: "SimplePost schedule (legacy)", uri });
  }

  registerWidgetResource(server, {
    description: "Interactive platform switcher with realistic social post previews.",
    name: "SimplePost post preview",
    uri: POST_PREVIEW_WIDGET_URI,
    widgetDescription: "Realistic SimplePost platform previews with a switcher for every selected social platform.",
    widgetName: "post-preview",
  });
}
