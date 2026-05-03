import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getAppBaseUrl } from "./config";

export const SIMPLEPOST_WIDGET_URI = "ui://simplepost/social-post-console-v1.html";

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
<section class="sp-shell" data-theme="dark" aria-live="polite">
  <header class="sp-header">
    <div class="sp-brand">
      <div class="sp-logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
      </div>
      <div>
        <div class="sp-kicker">
          <span class="sp-kicker-dot"></span>
          <span class="sp-kicker-label" id="kicker-label">SimplePost</span>
        </div>
        <h1 class="sp-title" id="title">Social post console</h1>
      </div>
    </div>
    <div class="sp-status" id="status-pill" data-tone="muted">Idle</div>
  </header>
  <main id="content" class="sp-content"></main>
  <footer class="sp-footer">
    <span class="sp-footer-label">Powered by SimplePost</span>
    <a class="sp-footer-link" id="manage-link" href="#" target="_blank" rel="noopener noreferrer">
      Manage in SimplePost
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>
    </a>
  </footer>
</section>`.trim();
}

function buildStyles(): string {
  return `
<style>
  :root {
    color-scheme: dark light;
  }

  /* SimplePost design tokens — dark, branded, lime accent */
  .sp-shell {
    --sp-bg: #0a0a0a;
    --sp-bg-soft: #0f0f0f;
    --sp-card: #111111;
    --sp-card-soft: #161616;
    --sp-border: #232323;
    --sp-border-soft: #1c1c1c;
    --sp-text: #f5f5f5;
    --sp-text-soft: #d4d4d4;
    --sp-muted: #858585;
    --sp-faint: #555555;
    --sp-primary: #c6f432;
    --sp-primary-ink: #0a0a0a;
    --sp-good: #c6f432;
    --sp-good-ink: #0a0a0a;
    --sp-bad: #ef4444;
    --sp-bad-soft: rgba(239, 68, 68, 0.12);
    --sp-warn: #f59e0b;
    --sp-warn-soft: rgba(245, 158, 11, 0.12);
    --sp-info: #38bdf8;
    --sp-info-soft: rgba(56, 189, 248, 0.12);
    --sp-radius-lg: 16px;
    --sp-radius-md: 12px;
    --sp-radius-sm: 8px;

    color: var(--sp-text);
    background: var(--sp-bg);
    font-family:
      Inter, "Inter Tight", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  /* Light fallback that still keeps the SimplePost identity */
  @media (prefers-color-scheme: light) {
    .sp-shell:not([data-theme="dark"]) {
      --sp-bg: #fafaf7;
      --sp-bg-soft: #ffffff;
      --sp-card: #ffffff;
      --sp-card-soft: #f5f5f2;
      --sp-border: #e5e5e0;
      --sp-border-soft: #ececec;
      --sp-text: #0a0a0a;
      --sp-text-soft: #1f1f1f;
      --sp-muted: #6b6b6b;
      --sp-faint: #a1a1a1;
    }
  }

  .sp-shell[data-theme="light"] {
    --sp-bg: #fafaf7;
    --sp-bg-soft: #ffffff;
    --sp-card: #ffffff;
    --sp-card-soft: #f5f5f2;
    --sp-border: #e5e5e0;
    --sp-border-soft: #ececec;
    --sp-text: #0a0a0a;
    --sp-text-soft: #1f1f1f;
    --sp-muted: #6b6b6b;
    --sp-faint: #a1a1a1;
  }

  .sp-shell *,
  .sp-shell *::before,
  .sp-shell *::after {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background: transparent;
  }

  .sp-shell {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 280px;
    padding: 18px;
    border-radius: var(--sp-radius-lg);
  }

  /* HEADER ----------------------------------------------------------------- */

  .sp-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .sp-brand {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .sp-logo {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--sp-primary);
    color: var(--sp-primary-ink);
    flex-shrink: 0;
  }

  .sp-logo svg {
    width: 18px;
    height: 18px;
  }

  .sp-kicker {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 2px;
  }

  .sp-kicker-dot {
    width: 5px;
    height: 5px;
    border-radius: 1px;
    background: var(--sp-primary);
    flex-shrink: 0;
  }

  .sp-kicker-label {
    font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
    font-size: 10px;
    font-weight: 500;
    line-height: 1;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--sp-muted);
  }

  .sp-title {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.2;
    color: var(--sp-text);
  }

  /* STATUS PILL / BADGES --------------------------------------------------- */

  .sp-status,
  .sp-badge,
  .sp-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 9px;
    border: 1px solid var(--sp-border);
    border-radius: 999px;
    background: var(--sp-card-soft);
    color: var(--sp-muted);
    font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
    font-size: 10px;
    font-weight: 500;
    line-height: 1;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .sp-status::before,
  .sp-badge[data-tone]::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.85;
  }

  .sp-chip {
    text-transform: none;
    letter-spacing: 0;
    font-family: inherit;
    font-size: 11px;
    color: var(--sp-text-soft);
  }

  .sp-status[data-tone="good"],
  .sp-badge[data-tone="good"] {
    border-color: rgba(198, 244, 50, 0.3);
    background: rgba(198, 244, 50, 0.08);
    color: var(--sp-primary);
  }

  .sp-status[data-tone="bad"],
  .sp-badge[data-tone="bad"] {
    border-color: rgba(239, 68, 68, 0.3);
    background: var(--sp-bad-soft);
    color: var(--sp-bad);
  }

  .sp-status[data-tone="warn"],
  .sp-badge[data-tone="warn"] {
    border-color: rgba(245, 158, 11, 0.3);
    background: var(--sp-warn-soft);
    color: var(--sp-warn);
  }

  .sp-status[data-tone="info"],
  .sp-badge[data-tone="info"] {
    border-color: rgba(56, 189, 248, 0.3);
    background: var(--sp-info-soft);
    color: var(--sp-info);
  }

  /* CONTENT ---------------------------------------------------------------- */

  .sp-content {
    display: grid;
    gap: 12px;
    flex: 1;
  }

  /* CARD ------------------------------------------------------------------- */

  .sp-card,
  .sp-empty {
    background: var(--sp-card);
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
    overflow: hidden;
  }

  .sp-card-pad {
    padding: 16px;
  }

  .sp-card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--sp-border-soft);
  }

  .sp-card-header > div:first-child {
    min-width: 0;
  }

  .sp-card-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--sp-text);
  }

  .sp-card-sub {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--sp-muted);
    line-height: 1.4;
  }

  .sp-card-body {
    padding: 14px 16px;
  }

  .sp-card-body--tight {
    padding: 10px 16px 14px;
  }

  /* EMPTY STATE ------------------------------------------------------------ */

  .sp-empty {
    display: grid;
    place-items: center;
    gap: 14px;
    padding: 32px 24px;
    text-align: center;
    border-style: dashed;
    background: transparent;
  }

  .sp-empty-mark {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: var(--sp-card);
    border: 1px solid var(--sp-border);
    color: var(--sp-primary);
  }

  .sp-empty-mark svg {
    width: 20px;
    height: 20px;
  }

  .sp-empty h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--sp-text);
  }

  .sp-empty p {
    margin: 0;
    max-width: 380px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--sp-muted);
  }

  .sp-empty-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    margin-top: 4px;
  }

  /* ACCOUNT GRID ----------------------------------------------------------- */

  .sp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px;
  }

  .sp-account-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sp-account {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: var(--sp-card-soft);
    border: 1px solid var(--sp-border-soft);
    border-radius: var(--sp-radius-md);
    min-width: 0;
  }

  .sp-account--full {
    width: 100%;
  }

  .sp-account-text {
    min-width: 0;
    flex: 1;
  }

  .sp-account-name {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--sp-text);
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sp-account-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
    font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--sp-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sp-account-meta-sep {
    color: var(--sp-faint);
  }

  /* PLATFORM AVATAR -------------------------------------------------------- */

  .sp-avatar {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 9px;
    color: #ffffff;
    flex-shrink: 0;
    background: #2c2c2c;
    overflow: hidden;
  }

  .sp-avatar svg {
    width: 16px;
    height: 16px;
  }

  .sp-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .sp-avatar--lg {
    width: 36px;
    height: 36px;
    border-radius: 10px;
  }

  .sp-avatar--lg svg {
    width: 18px;
    height: 18px;
  }

  /* Small platform badge that overlays the avatar when a profile picture is shown */
  .sp-avatar-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .sp-avatar-wrap .sp-avatar {
    border: 1px solid var(--sp-border-soft);
  }

  .sp-avatar-badge {
    position: absolute;
    right: -4px;
    bottom: -4px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #ffffff;
    border: 2px solid var(--sp-bg);
  }

  .sp-avatar-badge svg {
    width: 8px;
    height: 8px;
  }

  .sp-avatar[data-platform="x"],
  .sp-avatar[data-platform="tiktok"],
  .sp-avatar[data-platform="threads"] {
    background: #000000;
    color: #ffffff;
  }
  .sp-avatar[data-platform="youtube"] {
    background: #ff0033;
  }
  .sp-avatar[data-platform="instagram"] {
    background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
  }
  .sp-avatar[data-platform="facebook"] {
    background: #1877f2;
  }
  .sp-avatar[data-platform="bluesky"] {
    background: #0085ff;
  }
  .sp-avatar[data-platform="linkedin"] {
    background: #0a66c2;
  }
  .sp-avatar[data-platform="pinterest"] {
    background: #bd081c;
  }
  .sp-avatar[data-platform="telegram"] {
    background: #229ed9;
  }

  /* MESSAGE PREVIEW -------------------------------------------------------- */

  .sp-message-card {
    background: var(--sp-card-soft);
    border: 1px solid var(--sp-border-soft);
    border-radius: var(--sp-radius-md);
    padding: 12px 14px;
  }

  .sp-message-text {
    margin: 0;
    color: var(--sp-text-soft);
    font-size: 13px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .sp-message-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed var(--sp-border);
  }

  /* METRICS ---------------------------------------------------------------- */

  .sp-metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 8px;
  }

  .sp-metric {
    padding: 10px 12px;
    background: var(--sp-card-soft);
    border: 1px solid var(--sp-border-soft);
    border-radius: var(--sp-radius-md);
  }

  .sp-metric-value {
    display: block;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--sp-text);
    line-height: 1.1;
  }

  .sp-metric-value[data-tone="bad"] {
    color: var(--sp-bad);
  }
  .sp-metric-value[data-tone="warn"] {
    color: var(--sp-warn);
  }
  .sp-metric-value[data-tone="good"] {
    color: var(--sp-primary);
  }

  .sp-metric-label {
    display: block;
    margin-top: 4px;
    font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--sp-muted);
  }

  /* CHECKLIST (per-account validation) ------------------------------------- */

  .sp-checks {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .sp-check {
    background: var(--sp-card-soft);
    border: 1px solid var(--sp-border-soft);
    border-radius: var(--sp-radius-md);
    padding: 10px 12px;
  }

  .sp-check[data-tone="bad"] {
    border-color: rgba(239, 68, 68, 0.25);
    background: linear-gradient(180deg, var(--sp-bad-soft), transparent 60%), var(--sp-card-soft);
  }

  .sp-check-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .sp-check-issues {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 8px 0 0 42px;
  }

  .sp-issue {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--sp-text-soft);
  }

  .sp-issue-bullet {
    flex-shrink: 0;
    margin-top: 6px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
  }

  .sp-issue[data-tone="bad"] .sp-issue-bullet {
    background: var(--sp-bad);
  }
  .sp-issue[data-tone="warn"] .sp-issue-bullet {
    background: var(--sp-warn);
  }

  /* RESULT ROWS (post URLs / per-platform outcomes) ------------------------ */

  .sp-results {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .sp-result {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: var(--sp-card-soft);
    border: 1px solid var(--sp-border-soft);
    border-radius: var(--sp-radius-md);
    min-width: 0;
  }

  .sp-result-text {
    min-width: 0;
    flex: 1;
  }

  .sp-result-name {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--sp-text);
    line-height: 1.25;
  }

  .sp-result-message {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--sp-muted);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .sp-result-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
    font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
    font-size: 11px;
    color: var(--sp-info);
    text-decoration: none;
    overflow-wrap: anywhere;
    word-break: break-all;
  }

  .sp-result-link:hover {
    text-decoration: underline;
  }

  .sp-result-link svg {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
  }

  /* HERO STATUS (for create_post / scheduled) ------------------------------ */

  .sp-hero {
    padding: 18px 16px;
    background:
      radial-gradient(ellipse 70% 50% at 50% 0%, rgba(198, 244, 50, 0.1) 0%, transparent 70%),
      var(--sp-card);
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
  }

  .sp-hero[data-tone="bad"] {
    background:
      radial-gradient(ellipse 70% 50% at 50% 0%, rgba(239, 68, 68, 0.12) 0%, transparent 70%),
      var(--sp-card);
  }

  .sp-hero-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .sp-hero-icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    background: rgba(198, 244, 50, 0.12);
    color: var(--sp-primary);
    flex-shrink: 0;
  }

  .sp-hero[data-tone="bad"] .sp-hero-icon {
    background: var(--sp-bad-soft);
    color: var(--sp-bad);
  }

  .sp-hero-icon svg {
    width: 20px;
    height: 20px;
  }

  .sp-hero-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -0.015em;
    color: var(--sp-text);
  }

  .sp-hero-sub {
    margin: 2px 0 0;
    font-size: 12.5px;
    color: var(--sp-muted);
    line-height: 1.45;
  }

  /* FOOTER ----------------------------------------------------------------- */

  .sp-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-top: 6px;
  }

  .sp-footer-label {
    font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--sp-faint);
  }

  .sp-footer-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--sp-muted);
    text-decoration: none;
    transition: color 120ms ease;
  }

  .sp-footer-link:hover {
    color: var(--sp-primary);
  }

  /* RESPONSIVE ------------------------------------------------------------- */

  @media (max-width: 480px) {
    .sp-shell {
      padding: 14px;
    }
    .sp-header,
    .sp-card-header {
      flex-direction: column;
      align-items: flex-start;
    }
    .sp-title {
      font-size: 16px;
    }
  }
</style>`.trim();
}

function buildScript(appOrigin: string): string {
  return `
<script type="module">
  const APP_ORIGIN = ${JSON.stringify(appOrigin)};

  const root = document.querySelector(".sp-shell");
  const content = document.getElementById("content");
  const statusPill = document.getElementById("status-pill");
  const titleEl = document.getElementById("title");
  const kickerEl = document.getElementById("kicker-label");
  const manageLink = document.getElementById("manage-link");
  manageLink.href = APP_ORIGIN;

  // ---------- Helpers ----------

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  const PLATFORM_LABELS = {
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

  const PLATFORM_ICONS = {
    x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    instagram:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919C8.416 2.175 8.796 2.163 12 2.163zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>',
    facebook:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
    youtube:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
    tiktok:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>',
    telegram:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>',
    bluesky:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5.203 1.495C8.005 3.567 11.018 7.79 12 9.99c.982-2.2 3.995-6.423 6.797-8.495C20.815-.018 24 1.628 24 5.262c0 .726-.416 6.097-.66 6.97-.847 3.029-3.93 3.802-6.673 3.357 4.8.804 6.022 3.46 3.387 6.118-5.011 5.063-7.207-1.272-7.769-2.892-.103-.299-.151-.439-.151-.32 0-.119-.052.021-.156.32-.564 1.62-2.756 7.955-7.769 2.892-2.633-2.658-1.413-5.314 3.387-6.118-2.74.443-5.825-.328-6.671-3.357-.246-.873-.66-6.244-.66-6.97 0-3.634 3.182-5.28 5.205-3.767z"/></svg>',
    threads:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.74-1.757-.499-.582-1.27-.878-2.292-.88h-.024c-.832 0-1.965.226-2.687 1.302L7.36 8.945c.973-1.448 2.553-2.244 4.45-2.244h.034c3.21.02 5.149 1.987 5.337 5.43.107.046.215.088.319.137 1.49.7 2.583 1.762 3.16 3.07.806 1.829.88 4.811-1.516 7.171-1.832 1.81-4.045 2.638-7.117 2.658L12.186 24Z"/></svg>',
    linkedin:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.063 2.063 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
    pinterest:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.357-.629-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12.017 24c6.624 0 11.99-5.367 11.99-11.988C24.007 5.367 18.641.001 12.017.001z"/></svg>',
  };

  function platformLabel(platform) {
    if (!platform) return "Account";
    const key = String(platform).toLowerCase();
    return PLATFORM_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1));
  }

  function platformIconHtml(platform) {
    const key = String(platform || "").toLowerCase();
    const svg = PLATFORM_ICONS[key];
    if (svg) return svg;
    return '<span style="font-size:11px;font-weight:700;">' + escapeHtml((platform || "?").slice(0, 2).toUpperCase()) + "</span>";
  }

  function avatarHtml(platform, opts = {}) {
    const size = opts.size === "lg" ? " sp-avatar--lg" : "";
    const platformAttr = String(platform || "").toLowerCase();
    const profilePicture = opts.profilePicture;

    if (profilePicture) {
      // Rendered with a brand-colored background so a broken/missing image
      // still shows a recognizable platform chip. The badge in the corner
      // also reinforces which platform this account is on.
      return (
        '<div class="sp-avatar-wrap">' +
        '<div class="sp-avatar' + size + '" data-platform="' + escapeHtml(platformAttr) + '" aria-hidden="true">' +
        '<img src="' + escapeHtml(profilePicture) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="1" />' +
        "</div>" +
        '<span class="sp-avatar-badge" style="background:' + platformBrandColor(platformAttr) + '">' + platformIconHtml(platform) + "</span>" +
        "</div>"
      );
    }

    return '<div class="sp-avatar' + size + '" data-platform="' + escapeHtml(platformAttr) + '" aria-hidden="true">' + platformIconHtml(platform) + "</div>";
  }

  // Hide broken profile pictures so the underlying brand-colored avatar shows through.
  document.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (target && target.tagName === "IMG" && target.dataset && target.dataset.fallback === "1") {
        target.style.display = "none";
      }
    },
    true,
  );

  const PLATFORM_BRAND_COLORS = {
    x: "#000000",
    twitter: "#000000",
    instagram: "#dc2743",
    facebook: "#1877f2",
    youtube: "#ff0033",
    tiktok: "#000000",
    telegram: "#229ed9",
    bluesky: "#0085ff",
    threads: "#000000",
    linkedin: "#0a66c2",
    pinterest: "#bd081c",
  };

  function platformBrandColor(platform) {
    return PLATFORM_BRAND_COLORS[String(platform || "").toLowerCase()] || "#2c2c2c";
  }

  function accountDisplayName(account) {
    const handlePlatforms = new Set(["x", "instagram", "tiktok", "bluesky", "threads"]);
    const platform = String(account.platform || "").toLowerCase();
    if (handlePlatforms.has(platform) && account.username) return "@" + account.username;
    return account.displayName || (account.username ? "@" + account.username : platformLabel(account.platform));
  }

  function accountCardHtml(account, opts = {}) {
    const fullClass = opts.full ? " sp-account--full" : "";
    const meta = [platformLabel(account.platform)];
    if (account.username) meta.push(account.username.startsWith("@") ? account.username : "@" + account.username);
    return (
      '<div class="sp-account' + fullClass + '">' +
      avatarHtml(account.platform, { profilePicture: account.profilePicture }) +
      '<div class="sp-account-text">' +
      '<span class="sp-account-name">' + escapeHtml(accountDisplayName(account)) + "</span>" +
      '<span class="sp-account-meta">' +
      meta.map((part, idx) => (idx > 0 ? '<span class="sp-account-meta-sep">·</span>' : "") + "<span>" + escapeHtml(part) + "</span>").join("") +
      "</span>" +
      "</div>" +
      "</div>"
    );
  }

  function metricHtml(value, label, tone) {
    return (
      '<div class="sp-metric">' +
      '<span class="sp-metric-value"' + (tone ? ' data-tone="' + tone + '"' : "") + '>' + escapeHtml(value) + "</span>" +
      '<span class="sp-metric-label">' + escapeHtml(label) + "</span>" +
      "</div>"
    );
  }

  // ---------- Date formatting ----------

  function parseDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  let dateFmt;
  let timeFmt;
  let relFmt;

  function getFormatters() {
    if (!dateFmt) {
      try {
        dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
        timeFmt = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
        relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
      } catch (_) {
        dateFmt = { format: (d) => d.toDateString() };
        timeFmt = { format: (d) => d.toTimeString().slice(0, 5) };
        relFmt = { format: (n, u) => n + " " + u };
      }
    }
    return { dateFmt, timeFmt, relFmt };
  }

  function relativeFromNow(date) {
    const { relFmt } = getFormatters();
    const diff = date.getTime() - Date.now();
    const abs = Math.abs(diff);
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const week = 7 * day;
    if (abs < minute) return "in a moment";
    if (abs < hour) return relFmt.format(Math.round(diff / minute), "minute");
    if (abs < day) return relFmt.format(Math.round(diff / hour), "hour");
    if (abs < week) return relFmt.format(Math.round(diff / day), "day");
    return relFmt.format(Math.round(diff / week), "week");
  }

  function formatDateTime(value) {
    const date = parseDate(value);
    if (!date) return escapeHtml(value || "");
    const { dateFmt, timeFmt } = getFormatters();
    return dateFmt.format(date) + " · " + timeFmt.format(date);
  }

  function formatScheduledFor(value) {
    const date = parseDate(value);
    if (!date) return escapeHtml(value || "—");
    return formatDateTime(value) + ' <span style="color:var(--sp-faint)">(' + relativeFromNow(date) + ")</span>";
  }

  // ---------- Status helpers ----------

  function setStatus(label, tone) {
    statusPill.textContent = label;
    if (tone) statusPill.dataset.tone = tone;
    else delete statusPill.dataset.tone;
  }

  function setHeader(kicker, title) {
    if (kicker) kickerEl.textContent = kicker;
    if (title) titleEl.textContent = title;
  }

  // ---------- Renderers ----------

  function renderEmpty() {
    setHeader("SimplePost", "Social post console");
    setStatus("Idle", "muted");
    content.innerHTML =
      '<div class="sp-empty">' +
      '<div class="sp-empty-mark">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>' +
      "</div>" +
      "<h2>Run a SimplePost tool to get started</h2>" +
      "<p>I can list connected accounts, validate post text, preview targets and timing, and publish or schedule across multiple social platforms.</p>" +
      '<div class="sp-empty-tools">' +
      '<span class="sp-chip">list_accounts</span>' +
      '<span class="sp-chip">validate_post</span>' +
      '<span class="sp-chip">preview_post</span>' +
      '<span class="sp-chip">create_post</span>' +
      "</div>" +
      "</div>";
  }

  function renderAccounts(data) {
    setHeader("Accounts", "Connected accounts");
    const accounts = data.accounts || [];
    const platforms = (data.summary && data.summary.platforms) || [];

    setStatus(accounts.length ? accounts.length + " ready" : "No accounts", accounts.length ? "good" : "warn");

    if (!accounts.length) {
      content.innerHTML =
        '<div class="sp-empty">' +
        '<div class="sp-empty-mark">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M2 21a8 8 0 0 1 13.292-6"/><path d="M19 16v6"/><path d="M22 19h-6"/></svg>' +
        "</div>" +
        "<h2>No accounts connected yet</h2>" +
        '<p>Open SimplePost in your browser and connect a social account to publish from this conversation.</p>' +
        '<a class="sp-footer-link" style="color:var(--sp-primary)" href="' + escapeHtml(APP_ORIGIN) + '/accounts" target="_blank" rel="noopener noreferrer">Connect an account ' +
        '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>' +
        "</a>" +
        "</div>";
      return;
    }

    content.innerHTML =
      '<section class="sp-card">' +
      '<div class="sp-card-header">' +
      "<div>" +
      '<h2 class="sp-card-title">' + accounts.length + " account" + (accounts.length === 1 ? "" : "s") + " ready</h2>" +
      '<p class="sp-card-sub">Pass any of these accountId values to validate, preview, or create a post.</p>' +
      "</div>" +
      '<span class="sp-badge" data-tone="good">' + platforms.length + " platform" + (platforms.length === 1 ? "" : "s") + "</span>" +
      "</div>" +
      '<div class="sp-card-body">' +
      '<div class="sp-grid">' +
      accounts.map((a) => accountCardHtml(a)).join("") +
      "</div>" +
      "</div>" +
      "</section>";
  }

  function renderValidation(data) {
    setHeader("Validation", "Pre-flight check");
    const accounts = data.accounts || [];
    const errors = (data.summary && data.summary.errorCount) || 0;
    const warnings = (data.summary && data.summary.warningCount) || 0;
    const message = data.message || "";
    const charCount = message.length;
    const mediaCount = data.mediaCount || (data.summary && data.summary.mediaCount) || 0;

    setStatus(data.isValid ? "Ready" : "Needs edits", data.isValid ? "good" : "bad");

    const messageCard = message
      ? '<section class="sp-card">' +
        '<div class="sp-card-header">' +
        '<div><h2 class="sp-card-title">Draft message</h2><p class="sp-card-sub">' + charCount + " character" + (charCount === 1 ? "" : "s") + "</p></div>" +
        '<span class="sp-badge" data-tone="' + (data.isValid ? "good" : "bad") + '">' + (data.isValid ? "Validated" : "Has issues") + "</span>" +
        "</div>" +
        '<div class="sp-card-body sp-card-body--tight">' +
        '<div class="sp-message-card">' +
        '<p class="sp-message-text">' + escapeHtml(message) + "</p>" +
        (mediaCount
          ? '<div class="sp-message-meta"><span class="sp-chip">' + mediaCount + " media item" + (mediaCount === 1 ? "" : "s") + "</span></div>"
          : "") +
        "</div>" +
        "</div>" +
        "</section>"
      : "";

    content.innerHTML =
      '<section class="sp-hero" data-tone="' + (data.isValid ? "good" : "bad") + '">' +
      '<div class="sp-hero-row">' +
      '<div style="display:flex;align-items:center;gap:12px;min-width:0">' +
      '<div class="sp-hero-icon">' +
      (data.isValid
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>') +
      "</div>" +
      "<div>" +
      '<h2 class="sp-hero-title">' + (data.isValid ? "Post passes all platform rules" : "Fix " + errors + " issue" + (errors === 1 ? "" : "s") + " before posting") + "</h2>" +
      '<p class="sp-hero-sub">' + accounts.length + " account" + (accounts.length === 1 ? "" : "s") + " checked across " + ((data.platforms || []).length) + " platform" + ((data.platforms || []).length === 1 ? "" : "s") + ".</p>" +
      "</div>" +
      "</div>" +
      "</div>" +
      "</section>" +
      messageCard +
      '<section class="sp-card">' +
      '<div class="sp-card-header">' +
      '<div><h2 class="sp-card-title">Per-account checks</h2></div>' +
      '<div style="display:flex;gap:6px">' +
      (errors ? '<span class="sp-badge" data-tone="bad">' + errors + " error" + (errors === 1 ? "" : "s") + "</span>" : "") +
      (warnings ? '<span class="sp-badge" data-tone="warn">' + warnings + " warning" + (warnings === 1 ? "" : "s") + "</span>" : "") +
      (!errors && !warnings ? '<span class="sp-badge" data-tone="good">No issues</span>' : "") +
      "</div>" +
      "</div>" +
      '<div class="sp-card-body">' +
      '<div class="sp-checks">' +
      accounts.map(checkCardHtml).join("") +
      "</div>" +
      "</div>" +
      "</section>";
  }

  function checkCardHtml(account) {
    const issues = [
      ...(account.errors || []).map((i) => ({ ...i, tone: "bad" })),
      ...(account.warnings || []).map((i) => ({ ...i, tone: "warn" })),
    ];
    return (
      '<div class="sp-check"' + (account.isValid ? "" : ' data-tone="bad"') + ">" +
      '<div class="sp-check-row">' +
      avatarHtml(account.platform, { profilePicture: account.profilePicture }) +
      '<div class="sp-account-text">' +
      '<span class="sp-account-name">' + escapeHtml(accountDisplayName(account)) + "</span>" +
      '<span class="sp-account-meta"><span>' + escapeHtml(platformLabel(account.platform)) + "</span></span>" +
      "</div>" +
      '<span class="sp-badge" data-tone="' + (account.isValid ? "good" : "bad") + '">' + (account.isValid ? "OK" : "Fix") + "</span>" +
      "</div>" +
      (issues.length
        ? '<div class="sp-check-issues">' +
          issues
            .map(
              (issue) =>
                '<div class="sp-issue" data-tone="' + issue.tone + '">' +
                '<span class="sp-issue-bullet"></span>' +
                "<span>" + escapeHtml(issue.message) + (issue.field ? ' <span style="color:var(--sp-faint)">(' + escapeHtml(issue.field) + ")</span>" : "") + "</span>" +
                "</div>"
            )
            .join("") +
          "</div>"
        : "") +
      "</div>"
    );
  }

  function renderPreview(data) {
    setHeader("Preview", data.postingMode === "schedule" ? "Scheduled post preview" : "Publish-now preview");
    const accounts = data.accounts || [];
    const valid = data.validation && data.validation.isValid;
    const errors = (data.summary && data.summary.errorCount) || 0;
    const warnings = (data.summary && data.summary.warningCount) || 0;

    setStatus(valid ? "Ready to send" : "Blocked", valid ? "good" : "bad");

    const scheduledChip =
      data.postingMode === "schedule"
        ? '<span class="sp-chip">Schedule for ' + formatScheduledFor(data.scheduledFor) + "</span>"
        : '<span class="sp-chip" style="color:var(--sp-primary)">Publish immediately</span>';

    const mediaChip = data.summary && data.summary.mediaCount
      ? '<span class="sp-chip">' + data.summary.mediaCount + " media item" + (data.summary.mediaCount === 1 ? "" : "s") + "</span>"
      : "";

    const charCount = (data.message || "").length;

    content.innerHTML =
      '<section class="sp-card">' +
      '<div class="sp-card-header">' +
      '<div><h2 class="sp-card-title">Draft message</h2><p class="sp-card-sub">' + charCount + " character" + (charCount === 1 ? "" : "s") + "</p></div>" +
      '<span class="sp-badge" data-tone="' + (valid ? "good" : "bad") + '">' + (valid ? "Validated" : "Has issues") + "</span>" +
      "</div>" +
      '<div class="sp-card-body sp-card-body--tight">' +
      '<div class="sp-message-card">' +
      '<p class="sp-message-text">' + escapeHtml(data.message || "(empty message)") + "</p>" +
      '<div class="sp-message-meta">' + scheduledChip + mediaChip + "</div>" +
      "</div>" +
      "</div>" +
      "</section>" +
      '<section class="sp-card">' +
      '<div class="sp-card-header">' +
      '<div><h2 class="sp-card-title">Targets</h2><p class="sp-card-sub">Will publish to ' + accounts.length + " account" + (accounts.length === 1 ? "" : "s") + ".</p></div>' +
      '<span class="sp-badge">' + accounts.length + "</span>" +
      "</div>" +
      '<div class="sp-card-body sp-card-body--tight">' +
      '<div class="sp-grid">' + accounts.map((a) => accountCardHtml(a)).join("") + "</div>" +
      "</div>" +
      "</section>" +
      (errors || warnings
        ? '<section class="sp-card">' +
          '<div class="sp-card-header"><div><h2 class="sp-card-title">Issues to resolve</h2></div>' +
          '<div style="display:flex;gap:6px">' +
          (errors ? '<span class="sp-badge" data-tone="bad">' + errors + "</span>" : "") +
          (warnings ? '<span class="sp-badge" data-tone="warn">' + warnings + "</span>" : "") +
          "</div></div>" +
          '<div class="sp-card-body"><div class="sp-checks">' +
          (data.validation.accounts || []).filter((a) => (a.errors || []).length || (a.warnings || []).length).map(checkCardHtml).join("") +
          "</div></div>" +
          "</section>"
        : "");
  }

  function renderPost(data) {
    const post = data.post || {};
    const results = data.postingResults || [];
    const summary = data.summary || {};
    const isScheduled = post.status === "scheduled";
    const success = isScheduled || summary.overallSuccess === true;
    const failureCount = summary.failureCount || 0;
    const successCount = summary.successCount || 0;

    setHeader(isScheduled ? "Scheduled" : "Published", isScheduled ? "Post scheduled" : success ? "Post published" : "Post failed on some platforms");
    setStatus(isScheduled ? "Scheduled" : success ? "Live" : failureCount + " failed", success ? "good" : "bad");

    const heroIcon = isScheduled
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>'
      : success
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>';

    const heroTitle = isScheduled
      ? "Scheduled for " + formatScheduledFor(post.scheduledFor)
      : success
        ? "Published to " + successCount + " account" + (successCount === 1 ? "" : "s")
        : failureCount + " platform" + (failureCount === 1 ? "" : "s") + " failed";

    const heroSub = isScheduled
      ? "SimplePost will publish this post automatically."
      : success
        ? "All platforms confirmed delivery."
        : "Check the per-platform errors below and retry the failed accounts.";

    content.innerHTML =
      '<section class="sp-hero" data-tone="' + (success ? "good" : "bad") + '">' +
      '<div class="sp-hero-row">' +
      '<div style="display:flex;align-items:center;gap:12px;min-width:0">' +
      '<div class="sp-hero-icon">' + heroIcon + "</div>" +
      "<div>" +
      '<h2 class="sp-hero-title">' + heroTitle + "</h2>" +
      '<p class="sp-hero-sub">' + heroSub + "</p>" +
      "</div>" +
      "</div>" +
      "</div>" +
      "</section>" +
      (post.message
        ? '<section class="sp-card"><div class="sp-card-header"><div><h2 class="sp-card-title">Post content</h2><p class="sp-card-sub">ID ' + escapeHtml(post.id || "—") + "</p></div></div>" +
          '<div class="sp-card-body sp-card-body--tight"><div class="sp-message-card"><p class="sp-message-text">' + escapeHtml(post.message) + "</p></div></div>" +
          "</section>"
        : "") +
      (results.length
        ? '<section class="sp-card"><div class="sp-card-header"><div><h2 class="sp-card-title">Platform results</h2></div>' +
          '<div style="display:flex;gap:6px">' +
          (successCount ? '<span class="sp-badge" data-tone="good">' + successCount + " ok</span>" : "") +
          (failureCount ? '<span class="sp-badge" data-tone="bad">' + failureCount + " failed</span>" : "") +
          "</div></div>" +
          '<div class="sp-card-body"><div class="sp-results">' +
          results.map(postResultHtml).join("") +
          "</div></div></section>"
        : "");
  }

  function postResultHtml(result) {
    const platform = result.platform || "";
    const errorMessage = !result.success ? (result.error || result.message || "Unknown error") : null;
    return (
      '<div class="sp-result">' +
      avatarHtml(platform) +
      '<div class="sp-result-text">' +
      '<span class="sp-result-name">' + escapeHtml(platformLabel(platform)) + "</span>" +
      (errorMessage ? '<p class="sp-result-message" style="color:var(--sp-bad)">' + escapeHtml(errorMessage) + "</p>" : "") +
      (result.message && result.success ? '<p class="sp-result-message">' + escapeHtml(result.message) + "</p>" : "") +
      (result.postUrl
        ? '<a class="sp-result-link" href="' + escapeHtml(result.postUrl) + '" target="_blank" rel="noopener noreferrer">' +
          escapeHtml(result.postUrl) +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>' +
          "</a>"
        : "") +
      "</div>" +
      '<span class="sp-badge" data-tone="' + (result.success ? "good" : "bad") + '">' + (result.success ? "Posted" : "Failed") + "</span>" +
      "</div>"
    );
  }

  function renderMediaUpload(data) {
    setHeader("Media", "Upload complete");
    setStatus("Uploaded", "good");
    const sizeMb = data.size ? (data.size / (1024 * 1024)).toFixed(2) + " MB" : "—";
    content.innerHTML =
      '<section class="sp-hero" data-tone="good">' +
      '<div class="sp-hero-row">' +
      '<div style="display:flex;align-items:center;gap:12px;min-width:0">' +
      '<div class="sp-hero-icon">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>' +
      "</div>" +
      "<div>" +
      '<h2 class="sp-hero-title">' + escapeHtml(data.filename || "File") + " uploaded</h2>" +
      '<p class="sp-hero-sub">Use the URL below in validate_post, preview_post, or create_post.</p>' +
      "</div>" +
      "</div>" +
      "</div>" +
      "</section>" +
      '<section class="sp-card"><div class="sp-card-body"><div class="sp-metrics">' +
      metricHtml(String(data.type || "—"), "Type") +
      metricHtml(sizeMb, "Size") +
      metricHtml(escapeHtml(data.mimeType || "—"), "Mime") +
      "</div>" +
      '<div class="sp-message-card" style="margin-top:10px">' +
      '<a class="sp-result-link" href="' + escapeHtml(data.url || "#") + '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(data.url || "") +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>' +
      "</a></div></div></section>";
  }

  // ---------- Dispatcher ----------

  function render(payload) {
    const data = (payload && payload.structuredContent) || payload || {};
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

  // ---------- Theme handling ----------

  function applyTheme(theme) {
    if (!theme) return;
    if (theme === "light" || theme === "dark") {
      root.dataset.theme = theme;
    }
  }

  // ---------- Wiring ----------
  //
  // The widget supports two host transports so it works in both ChatGPT
  // (window.openai globals + "openai:set_globals" CustomEvent) and any
  // MCP Apps compliant host (postMessage with "ui/notifications/tool-result").

  function readFromOpenAi() {
    const api = typeof window !== "undefined" ? window.openai : undefined;
    if (!api) return false;
    if (api.theme) applyTheme(api.theme);
    const output = api.toolOutput;
    if (output && typeof output === "object") {
      // ChatGPT exposes the parsed structuredContent directly on toolOutput.
      // Other hosts may wrap it inside a CallToolResult shape.
      render(output.structuredContent ? output : { structuredContent: output });
      return true;
    }
    return false;
  }

  if (!readFromOpenAi()) {
    renderEmpty();
  }

  window.addEventListener(
    "openai:set_globals",
    (event) => {
      const globals = (event && event.detail && event.detail.globals) || {};
      if (globals.theme) applyTheme(globals.theme);
      if ("toolOutput" in globals || "toolInput" in globals) {
        readFromOpenAi();
      }
    },
    { passive: true },
  );

  window.addEventListener(
    "message",
    (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") return;
      if (message.method === "ui/notifications/tool-result") {
        render(message.params || {});
      } else if (message.method === "ui/notifications/host-context-changed") {
        applyTheme(message.params && message.params.theme);
      }
    },
    { passive: true },
  );
</script>`.trim();
}
