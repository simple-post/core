import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getAppBaseUrl } from "./config";

export const SIMPLEPOST_WIDGET_URI = "ui://simplepost/social-post-console-v3.html";

const SOCIAL_REDIRECT_DOMAINS = [
  "https://x.com",
  "https://www.facebook.com",
  "https://www.instagram.com",
  "https://www.tiktok.com",
  "https://www.youtube.com",
  "https://youtu.be",
  "https://t.me",
  "https://bsky.app",
  "https://www.threads.net",
  "https://www.linkedin.com",
  "https://www.pinterest.com",
];

export function registerSimplePostAppResource(server: McpServer): void {
  const appOrigin = new URL(getAppBaseUrl()).origin;

  registerAppResource(
    server,
    "SimplePost Social Post Console",
    SIMPLEPOST_WIDGET_URI,
    {
      description:
        "Interactive SimplePost summary for connected accounts, post validation, previews, and posting results.",
      _meta: {
        ui: {
          prefersBorder: true,
          domain: appOrigin,
          csp: {
            connectDomains: [appOrigin],
            resourceDomains: [appOrigin],
          },
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: SIMPLEPOST_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: buildWidgetHtml(appOrigin),
          _meta: {
            ui: {
              prefersBorder: true,
              domain: appOrigin,
              csp: {
                connectDomains: [appOrigin],
                resourceDomains: [appOrigin],
              },
            },
            "openai/widgetDescription":
              "Shows SimplePost account, validation, preview, and posting status from the latest tool call.",
            "openai/widgetPrefersBorder": true,
            "openai/widgetDomain": appOrigin,
            "openai/widgetCSP": {
              connect_domains: [appOrigin],
              resource_domains: [appOrigin],
              redirect_domains: [appOrigin, ...SOCIAL_REDIRECT_DOMAINS],
            },
          },
        },
      ],
    }),
  );
}

function buildWidgetHtml(appOrigin: string): string {
  return `${buildHtmlShell()}
${buildStyles()}
${buildScript(appOrigin)}`.trim();
}

function buildHtmlShell(): string {
  return `
<section class="sp" data-theme="dark" aria-live="polite">
  <header class="sp-header">
    <div class="sp-logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
    </div>
    <div class="sp-header-text">
      <h1 class="sp-title" id="title">SimplePost</h1>
      <p class="sp-subtitle" id="subtitle">Social post console</p>
    </div>
  </header>
  <main id="content" class="sp-body"></main>
  <footer class="sp-footer">
    <a class="sp-footer-link" id="manage-link" href="#" target="_blank" rel="noopener noreferrer">
      Manage in SimplePost
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>
    </a>
  </footer>
</section>`.trim();
}

function buildStyles(): string {
  return `
<style>
  :root { color-scheme: dark light; }

  .sp {
    --sp-bg: #0a0a0a;
    --sp-card: #141414;
    --sp-border: #232323;
    --sp-text: #f5f5f5;
    --sp-muted: #858585;
    --sp-faint: #555555;
    --sp-primary: #c6f432;
    --sp-bad: #ef4444;
    --sp-warn: #f59e0b;
    --sp-info: #38bdf8;

    color: var(--sp-text);
    background: var(--sp-bg);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;

    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px 18px 12px;
    border-radius: 16px;
  }

  @media (prefers-color-scheme: light) {
    .sp:not([data-theme="dark"]) {
      --sp-bg: #ffffff;
      --sp-card: #f7f7f5;
      --sp-border: #e5e5e0;
      --sp-text: #0a0a0a;
      --sp-muted: #6b6b6b;
      --sp-faint: #a1a1a1;
    }
  }

  .sp[data-theme="light"] {
    --sp-bg: #ffffff;
    --sp-card: #f7f7f5;
    --sp-border: #e5e5e0;
    --sp-text: #0a0a0a;
    --sp-muted: #6b6b6b;
    --sp-faint: #a1a1a1;
  }

  .sp *,
  .sp *::before,
  .sp *::after { box-sizing: border-box; }

  body { margin: 0; background: transparent; }

  /* HEADER ------------------------------------------------------------- */

  .sp-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .sp-logo {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--sp-primary);
    color: #0a0a0a;
    flex-shrink: 0;
  }

  .sp-logo svg { width: 14px; height: 14px; }

  .sp-header-text { min-width: 0; flex: 1; }

  .sp-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--sp-text);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sp-subtitle {
    margin: 1px 0 0;
    font-size: 12px;
    color: var(--sp-muted);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* BODY --------------------------------------------------------------- */

  .sp-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 24px;
  }

  /* ACCOUNT / RESULT LIST ROWS ---------------------------------------- */

  .sp-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sp-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: var(--sp-card);
    border: 1px solid var(--sp-border);
    border-radius: 10px;
    min-width: 0;
  }

  .sp-row-text { min-width: 0; flex: 1; }

  .sp-row-name {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--sp-text);
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sp-row-meta {
    display: block;
    margin-top: 1px;
    font-size: 11.5px;
    color: var(--sp-muted);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sp-row-meta--bad { color: var(--sp-bad); }

  .sp-row-aside {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--sp-muted);
  }

  /* AVATAR ------------------------------------------------------------- */

  .sp-avatar {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    color: #ffffff;
    background: #2c2c2c;
    flex-shrink: 0;
    overflow: hidden;
  }

  .sp-avatar svg { width: 14px; height: 14px; }
  .sp-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }

  .sp-avatar--sm { width: 18px; height: 18px; border-radius: 5px; }
  .sp-avatar--sm svg { width: 9px; height: 9px; }

  .sp-avatar[data-platform="x"],
  .sp-avatar[data-platform="tiktok"],
  .sp-avatar[data-platform="threads"] { background: #000000; }
  .sp-avatar[data-platform="youtube"] { background: #ff0033; }
  .sp-avatar[data-platform="instagram"] {
    background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
  }
  .sp-avatar[data-platform="facebook"] { background: #1877f2; }
  .sp-avatar[data-platform="bluesky"] { background: #0085ff; }
  .sp-avatar[data-platform="linkedin"] { background: #0a66c2; }
  .sp-avatar[data-platform="pinterest"] { background: #bd081c; }
  .sp-avatar[data-platform="telegram"] { background: #229ed9; }

  /* POST MESSAGE PREVIEW ---------------------------------------------- */

  .sp-message {
    margin: 0;
    padding: 12px 14px;
    background: var(--sp-card);
    border: 1px solid var(--sp-border);
    border-radius: 12px;
    color: var(--sp-text);
    font-size: 14px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* POSTING TO (target list as inline chips) -------------------------- */

  .sp-targets {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 12px;
    color: var(--sp-muted);
    padding: 0 2px;
  }

  .sp-targets-label {
    margin-right: 2px;
    color: var(--sp-faint);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 500;
  }

  .sp-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px 3px 3px;
    background: var(--sp-card);
    border: 1px solid var(--sp-border);
    border-radius: 999px;
    color: var(--sp-text);
    font-size: 12px;
    line-height: 1;
  }

  .sp-chip .sp-avatar { border-radius: 50%; }

  /* ISSUE LIST (validation errors) ------------------------------------ */

  .sp-issues {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sp-issue {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 9px 11px;
    background: var(--sp-card);
    border: 1px solid var(--sp-border);
    border-left: 3px solid var(--sp-warn);
    border-radius: 8px;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--sp-text);
    overflow-wrap: anywhere;
  }

  .sp-issue[data-tone="bad"] { border-left-color: var(--sp-bad); }

  .sp-issue .sp-avatar { margin-top: 1px; }

  /* LINKS -------------------------------------------------------------- */

  .sp-link {
    color: var(--sp-info);
    text-decoration: none;
    font-size: 12px;
    overflow-wrap: anywhere;
    word-break: break-all;
  }

  .sp-link:hover { text-decoration: underline; }

  /* EMPTY STATE -------------------------------------------------------- */

  .sp-empty {
    margin: 4px 0;
    font-size: 12.5px;
    color: var(--sp-muted);
    line-height: 1.5;
  }

  /* FOOTER ------------------------------------------------------------- */

  .sp-footer {
    display: flex;
    justify-content: flex-end;
    padding-top: 4px;
  }

  .sp-footer-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--sp-faint);
    text-decoration: none;
    transition: color 120ms ease;
  }

  .sp-footer-link:hover { color: var(--sp-primary); }
</style>`.trim();
}

function buildScript(appOrigin: string): string {
  return `
<script>
(function () {
  var APP_ORIGIN = ${JSON.stringify(appOrigin)};

  var root = document.querySelector(".sp");
  var content = document.getElementById("content");
  var titleEl = document.getElementById("title");
  var subtitleEl = document.getElementById("subtitle");
  var manageLink = document.getElementById("manage-link");
  if (manageLink) manageLink.href = APP_ORIGIN;

  // ---------- Helpers ----------

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var PLATFORM_LABELS = {
    x: "X",
    twitter: "X",
    instagram: "Instagram",
    facebook: "Facebook",
    youtube: "YouTube",
    tiktok: "TikTok",
    telegram: "Telegram",
    bluesky: "Bluesky",
    threads: "Threads",
    linkedin: "LinkedIn",
    pinterest: "Pinterest",
  };

  var PLATFORM_ICONS = {
    x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919C8.416 2.175 8.796 2.163 12 2.163zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>',
    telegram: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>',
    bluesky: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5.203 1.495C8.005 3.567 11.018 7.79 12 9.99c.982-2.2 3.995-6.423 6.797-8.495C20.815-.018 24 1.628 24 5.262c0 .726-.416 6.097-.66 6.97-.847 3.029-3.93 3.802-6.673 3.357 4.8.804 6.022 3.46 3.387 6.118-5.011 5.063-7.207-1.272-7.769-2.892-.103-.299-.151-.439-.151-.32 0-.119-.052.021-.156.32-.564 1.62-2.756 7.955-7.769 2.892-2.633-2.658-1.413-5.314 3.387-6.118-2.74.443-5.825-.328-6.671-3.357-.246-.873-.66-6.244-.66-6.97 0-3.634 3.182-5.28 5.205-3.767z"/></svg>',
    threads: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.74-1.757-.499-.582-1.27-.878-2.292-.88h-.024c-.832 0-1.965.226-2.687 1.302L7.36 8.945c.973-1.448 2.553-2.244 4.45-2.244h.034c3.21.02 5.149 1.987 5.337 5.43.107.046.215.088.319.137 1.49.7 2.583 1.762 3.16 3.07.806 1.829.88 4.811-1.516 7.171-1.832 1.81-4.045 2.638-7.117 2.658L12.186 24Z"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.063 2.063 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
    pinterest: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.357-.629-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12.017 24c6.624 0 11.99-5.367 11.99-11.988C24.007 5.367 18.641.001 12.017.001z"/></svg>',
  };

  function platformLabel(platform) {
    if (!platform) return "Account";
    var key = String(platform).toLowerCase();
    return PLATFORM_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1));
  }

  function platformIconHtml(platform) {
    var key = String(platform == null ? "" : platform).toLowerCase();
    var svg = PLATFORM_ICONS[key];
    if (svg) return svg;
    return '<span style="font-size:9px;font-weight:700;">' + escapeHtml((platform || "?").slice(0, 2).toUpperCase()) + "</span>";
  }

  function avatarHtml(platform, opts) {
    opts = opts || {};
    var sizeClass = opts.size === "sm" ? " sp-avatar--sm" : "";
    var platformAttr = String(platform == null ? "" : platform).toLowerCase();
    var profilePicture = opts.profilePicture;

    if (profilePicture) {
      return (
        '<div class="sp-avatar' + sizeClass + '" data-platform="' + escapeHtml(platformAttr) + '" aria-hidden="true">' +
        '<img src="' + escapeHtml(profilePicture) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="1" />' +
        "</div>"
      );
    }

    return (
      '<div class="sp-avatar' + sizeClass + '" data-platform="' + escapeHtml(platformAttr) + '" aria-hidden="true">' +
      platformIconHtml(platform) +
      "</div>"
    );
  }

  // Hide broken profile pictures so the brand-colored avatar shows through.
  document.addEventListener(
    "error",
    function (event) {
      var target = event.target;
      if (target && target.tagName === "IMG" && target.dataset && target.dataset.fallback === "1") {
        target.style.display = "none";
      }
    },
    true,
  );

  function accountDisplayName(account) {
    var handlePlatforms = { x: 1, instagram: 1, tiktok: 1, bluesky: 1, threads: 1 };
    var platform = String(account.platform == null ? "" : account.platform).toLowerCase();
    if (handlePlatforms[platform] && account.username) return "@" + account.username;
    return account.displayName || (account.username ? "@" + account.username : platformLabel(account.platform));
  }

  // ---------- Date formatting ----------

  var dateTimeFmt;

  function formatScheduledFor(value) {
    if (!value) return "";
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    if (!dateTimeFmt) {
      try {
        dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
      } catch (_) {
        dateTimeFmt = { format: function (d) { return d.toString(); } };
      }
    }
    return dateTimeFmt.format(date);
  }

  // ---------- Header / setters ----------

  function setHeader(title, subtitle) {
    titleEl.textContent = title || "SimplePost";
    subtitleEl.textContent = subtitle || "";
    subtitleEl.style.display = subtitle ? "" : "none";
  }

  // ---------- Render fragments ----------

  function accountRowHtml(account) {
    return (
      '<li class="sp-row">' +
      avatarHtml(account.platform, { profilePicture: account.profilePicture }) +
      '<div class="sp-row-text">' +
      '<span class="sp-row-name">' + escapeHtml(accountDisplayName(account)) + "</span>" +
      '<span class="sp-row-meta">' + escapeHtml(platformLabel(account.platform)) + "</span>" +
      "</div>" +
      "</li>"
    );
  }

  function messageHtml(message) {
    return '<blockquote class="sp-message">' + escapeHtml(message || "(empty message)") + "</blockquote>";
  }

  function chipHtml(account) {
    return (
      '<span class="sp-chip">' +
      avatarHtml(account.platform, { size: "sm", profilePicture: account.profilePicture }) +
      escapeHtml(accountDisplayName(account)) +
      "</span>"
    );
  }

  function targetsHtml(accounts) {
    if (!accounts || !accounts.length) return "";
    return (
      '<div class="sp-targets">' +
      '<span class="sp-targets-label">Posting to</span>' +
      accounts.map(chipHtml).join("") +
      "</div>"
    );
  }

  function collectIssues(accounts) {
    var items = [];
    (accounts || []).forEach(function (account) {
      (account.errors || []).forEach(function (issue) {
        items.push({ account: account, message: issue.message, tone: "bad" });
      });
      (account.warnings || []).forEach(function (issue) {
        items.push({ account: account, message: issue.message, tone: "warn" });
      });
    });
    return items;
  }

  function issuesHtml(issues) {
    if (!issues.length) return "";
    return (
      '<div class="sp-issues">' +
      issues
        .map(function (item) {
          return (
            '<div class="sp-issue" data-tone="' + item.tone + '">' +
            avatarHtml(item.account.platform, { size: "sm" }) +
            "<span><strong>" + escapeHtml(platformLabel(item.account.platform)) + "</strong> — " + escapeHtml(item.message) + "</span>" +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function postResultRowHtml(result) {
    var success = !!result.success;
    var errorText = !success ? (result.error || result.message || "Failed") : "";
    var aside = "";
    if (success && result.postUrl) {
      aside =
        '<a class="sp-link" href="' + escapeHtml(result.postUrl) + '" target="_blank" rel="noopener noreferrer">View post</a>';
    } else if (success) {
      aside = '<span class="sp-row-aside">Posted</span>';
    } else {
      aside = '<span class="sp-row-aside" style="color:var(--sp-bad)">Failed</span>';
    }
    return (
      '<li class="sp-row">' +
      avatarHtml(result.platform) +
      '<div class="sp-row-text">' +
      '<span class="sp-row-name">' + escapeHtml(platformLabel(result.platform)) + "</span>" +
      (errorText
        ? '<span class="sp-row-meta sp-row-meta--bad">' + escapeHtml(errorText) + "</span>"
        : result.message
          ? '<span class="sp-row-meta">' + escapeHtml(result.message) + "</span>"
          : "") +
      "</div>" +
      aside +
      "</li>"
    );
  }

  // ---------- Renderers ----------

  function renderEmpty() {
    setHeader("SimplePost", "Run a tool to begin");
    content.innerHTML = "";
  }

  function renderAccounts(data) {
    var accounts = data.accounts || [];
    setHeader("Connected accounts", accounts.length ? accounts.length + " account" + (accounts.length === 1 ? "" : "s") : "");

    if (!accounts.length) {
      content.innerHTML =
        '<p class="sp-empty">No social accounts connected yet. ' +
        '<a class="sp-link" href="' + escapeHtml(APP_ORIGIN) + '/accounts" target="_blank" rel="noopener noreferrer">Connect one →</a></p>';
      return;
    }

    content.innerHTML = '<ul class="sp-list">' + accounts.map(accountRowHtml).join("") + "</ul>";
  }

  function renderValidation(data) {
    var accounts = data.accounts || [];
    var issues = collectIssues(accounts);
    var hasIssues = issues.length > 0;

    setHeader(hasIssues ? "Issues to fix" : "Post preview", hasIssues ? "" : buildTargetsSubtitle(accounts));

    content.innerHTML =
      messageHtml(data.message) +
      (hasIssues ? issuesHtml(issues) : "") +
      (hasIssues ? targetsHtml(accounts) : "");
  }

  function renderPreview(data) {
    var accounts = data.accounts || [];
    var validation = data.validation || {};
    var issues = collectIssues(validation.accounts || []);
    var hasIssues = issues.length > 0;
    var isScheduled = data.postingMode === "schedule";

    var title = hasIssues ? "Issues to fix" : isScheduled ? "Scheduled post" : "Post preview";
    var subtitle;
    if (hasIssues) subtitle = "";
    else if (isScheduled) subtitle = formatScheduledFor(data.scheduledFor);
    else subtitle = buildTargetsSubtitle(accounts);

    setHeader(title, subtitle);

    content.innerHTML =
      messageHtml(data.message) +
      (hasIssues ? issuesHtml(issues) : "") +
      (hasIssues || isScheduled ? targetsHtml(accounts) : "");
  }

  function renderPost(data) {
    var post = data.post || {};
    var summary = data.summary || {};
    var results = data.postingResults || [];
    var isScheduled = post.status === "scheduled";
    var success = isScheduled || summary.overallSuccess === true;

    var title;
    var subtitle;
    if (isScheduled) {
      title = "Post scheduled";
      subtitle = formatScheduledFor(post.scheduledFor);
    } else if (success) {
      title = "Post published";
      subtitle = (summary.successCount || results.length) + " account" + ((summary.successCount || results.length) === 1 ? "" : "s");
    } else {
      title = "Post failed";
      subtitle = summary.failureCount + " platform" + (summary.failureCount === 1 ? "" : "s") + " failed";
    }

    setHeader(title, subtitle);

    content.innerHTML =
      messageHtml(post.message || data.message) +
      (results.length ? '<ul class="sp-list">' + results.map(postResultRowHtml).join("") + "</ul>" : "");
  }

  function renderMediaUpload(data) {
    setHeader("File uploaded", data.filename || "");
    content.innerHTML =
      '<p class="sp-empty">' +
      '<a class="sp-link" href="' + escapeHtml(data.url || "#") + '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(data.url || "") +
      "</a></p>";
  }

  function buildTargetsSubtitle(accounts) {
    if (!accounts || !accounts.length) return "";
    if (accounts.length === 1) return "to " + accountDisplayName(accounts[0]) + " on " + platformLabel(accounts[0].platform);
    return "to " + accounts.length + " accounts";
  }

  // ---------- Dispatcher ----------

  function render(payload) {
    var data = (payload && payload.structuredContent) || payload;
    if (!data || typeof data !== "object") {
      renderEmpty();
      return;
    }
    if (data.kind === "accounts") return renderAccounts(data);
    if (data.kind === "validation") return renderValidation(data);
    if (data.kind === "preview") return renderPreview(data);
    if (data.kind === "post") return renderPost(data);
    if (data.kind === "media_upload") return renderMediaUpload(data);
    renderEmpty();
  }

  // ---------- Theme ----------

  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  }

  // ---------- Wiring (ChatGPT window.openai + MCP Apps postMessage) ----------

  function renderFromOutput(output) {
    if (output == null) {
      renderEmpty();
      return;
    }
    if (typeof output === "object" && output.structuredContent) render(output);
    else render({ structuredContent: output });
  }

  function readFromOpenAi() {
    var api = window.openai;
    if (!api) return;
    if (api.theme) applyTheme(api.theme);
    renderFromOutput(api.toolOutput);
  }

  if (window.openai) {
    if (window.openai.theme) applyTheme(window.openai.theme);
    if (window.openai.toolOutput) renderFromOutput(window.openai.toolOutput);
    else renderEmpty();
  } else {
    renderEmpty();
  }

  window.addEventListener(
    "openai:set_globals",
    function (event) {
      var detail = (event && event.detail) || {};
      var globals = detail.globals || detail || {};
      if (globals.theme) applyTheme(globals.theme);
      if ("toolOutput" in globals) {
        renderFromOutput(globals.toolOutput != null ? globals.toolOutput : (window.openai && window.openai.toolOutput));
      }
    },
    { passive: true },
  );

  window.addEventListener("load", readFromOpenAi, { passive: true });

  window.addEventListener(
    "message",
    function (event) {
      if (event.source !== window.parent) return;
      var message = event.data;
      if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") return;
      if (message.method === "ui/notifications/tool-result") render(message.params || {});
      else if (message.method === "ui/notifications/host-context-changed") applyTheme(message.params && message.params.theme);
    },
    { passive: true },
  );
})();
</script>`.trim();
}
