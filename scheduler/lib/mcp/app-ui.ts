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
          text: buildWidgetHtml(),
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

function buildWidgetHtml(): string {
  return `
<section class="sp-shell" aria-live="polite">
  <header class="sp-header">
    <div>
      <p class="sp-kicker">SimplePost</p>
      <h1>Social post console</h1>
    </div>
    <div class="sp-status" id="status-pill">Waiting</div>
  </header>
  <main id="content" class="sp-content">
    <div class="sp-empty">
      <div class="sp-empty-mark">SP</div>
      <p>Run a SimplePost tool to see accounts, validation, previews, or publishing results here.</p>
    </div>
  </main>
</section>
<style>
  :root {
    color-scheme: light dark;
    --sp-bg: #f8fafc;
    --sp-panel: #ffffff;
    --sp-text: #162033;
    --sp-muted: #667085;
    --sp-line: #d9e2ec;
    --sp-green: #12715b;
    --sp-red: #b42318;
    --sp-yellow: #9a6700;
    --sp-blue: #2457a7;
    --sp-teal: #0f766e;
    --sp-shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --sp-bg: #101820;
      --sp-panel: #17212b;
      --sp-text: #f3f7fb;
      --sp-muted: #a4b0bf;
      --sp-line: #2c3a49;
      --sp-shadow: 0 10px 28px rgba(0, 0, 0, 0.25);
    }
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background: var(--sp-bg);
    color: var(--sp-text);
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .sp-shell {
    min-height: 320px;
    padding: 18px;
    background: var(--sp-bg);
  }

  .sp-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
  }

  .sp-kicker {
    margin: 0 0 4px;
    color: var(--sp-teal);
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: 22px;
    line-height: 1.2;
    letter-spacing: 0;
  }

  .sp-status,
  .sp-chip,
  .sp-badge {
    border: 1px solid var(--sp-line);
    border-radius: 999px;
    color: var(--sp-muted);
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    padding: 7px 9px;
    white-space: nowrap;
  }

  .sp-status[data-tone="good"],
  .sp-badge[data-tone="good"] {
    border-color: rgba(18, 113, 91, 0.3);
    color: var(--sp-green);
  }

  .sp-status[data-tone="bad"],
  .sp-badge[data-tone="bad"] {
    border-color: rgba(180, 35, 24, 0.3);
    color: var(--sp-red);
  }

  .sp-status[data-tone="warn"],
  .sp-badge[data-tone="warn"] {
    border-color: rgba(154, 103, 0, 0.35);
    color: var(--sp-yellow);
  }

  .sp-content {
    display: grid;
    gap: 12px;
  }

  .sp-empty,
  .sp-panel {
    background: var(--sp-panel);
    border: 1px solid var(--sp-line);
    border-radius: 8px;
    box-shadow: var(--sp-shadow);
  }

  .sp-empty {
    display: grid;
    place-items: center;
    gap: 10px;
    min-height: 190px;
    padding: 28px;
    text-align: center;
  }

  .sp-empty p {
    max-width: 440px;
    margin: 0;
    color: var(--sp-muted);
    font-size: 14px;
    line-height: 1.5;
  }

  .sp-empty-mark,
  .sp-avatar {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    border-radius: 8px;
    background: #0f766e;
    color: #ffffff;
    font-size: 13px;
    font-weight: 800;
  }

  .sp-panel {
    padding: 14px;
  }

  .sp-panel-header,
  .sp-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .sp-panel-header {
    margin-bottom: 12px;
  }

  .sp-panel-title {
    margin: 0;
    font-size: 15px;
    line-height: 1.25;
  }

  .sp-panel-subtitle,
  .sp-meta,
  .sp-message {
    color: var(--sp-muted);
    font-size: 13px;
    line-height: 1.45;
  }

  .sp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
  }

  .sp-account,
  .sp-result,
  .sp-metric {
    border: 1px solid var(--sp-line);
    border-radius: 8px;
    padding: 12px;
    background: color-mix(in srgb, var(--sp-panel) 92%, var(--sp-bg));
  }

  .sp-account {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .sp-account strong,
  .sp-result strong {
    display: block;
    overflow-wrap: anywhere;
    font-size: 14px;
    line-height: 1.25;
  }

  .sp-avatar {
    width: 34px;
    height: 34px;
    flex: 0 0 auto;
    background: #2457a7;
    font-size: 11px;
  }

  .sp-message {
    margin: 8px 0 0;
    white-space: pre-wrap;
  }

  .sp-issues {
    display: grid;
    gap: 8px;
  }

  .sp-issue {
    border-left: 3px solid var(--sp-yellow);
    padding: 8px 10px;
    background: color-mix(in srgb, var(--sp-yellow) 9%, transparent);
    font-size: 13px;
    line-height: 1.4;
  }

  .sp-issue[data-tone="bad"] {
    border-left-color: var(--sp-red);
    background: color-mix(in srgb, var(--sp-red) 9%, transparent);
  }

  .sp-link {
    color: var(--sp-blue);
    overflow-wrap: anywhere;
  }

  @media (max-width: 520px) {
    .sp-shell {
      padding: 14px;
    }

    .sp-header,
    .sp-panel-header,
    .sp-row {
      align-items: flex-start;
      flex-direction: column;
    }

    h1 {
      font-size: 19px;
    }
  }
</style>
<script type="module">
  const content = document.getElementById("content");
  const statusPill = document.getElementById("status-pill");

  function text(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function initials(account) {
    const source = account.displayName || account.username || account.platform || "SP";
    return source.replace(/^@/, "").slice(0, 2).toUpperCase();
  }

  function platformLabel(platform) {
    if (!platform) return "Account";
    return String(platform).replace(/(^|[-_ ])\\w/g, (match) => match.toUpperCase()).replace(/[-_]/g, " ");
  }

  function setStatus(label, tone) {
    statusPill.textContent = label;
    if (tone) statusPill.dataset.tone = tone;
    else delete statusPill.dataset.tone;
  }

  function accountCard(account) {
    return \`
      <div class="sp-account">
        <div class="sp-avatar">\${text(initials(account))}</div>
        <div>
          <strong>\${text(account.displayName || account.username || platformLabel(account.platform))}</strong>
          <div class="sp-meta">\${text(platformLabel(account.platform))}\${account.username ? " / " + text(account.username) : ""}</div>
        </div>
      </div>
    \`;
  }

  function metric(label, value) {
    return \`<div class="sp-metric"><strong>\${text(value)}</strong><div class="sp-meta">\${text(label)}</div></div>\`;
  }

  function renderAccounts(data) {
    const accounts = data.accounts || [];
    setStatus(accounts.length ? "Accounts ready" : "No accounts", accounts.length ? "good" : "warn");
    content.innerHTML = \`
      <section class="sp-panel">
        <div class="sp-panel-header">
          <div>
            <h2 class="sp-panel-title">Connected accounts</h2>
            <div class="sp-panel-subtitle">\${text(accounts.length)} account\${accounts.length === 1 ? "" : "s"} available for SimplePost.</div>
          </div>
          <span class="sp-badge" data-tone="\${accounts.length ? "good" : "warn"}">\${text(accounts.length)}</span>
        </div>
        <div class="sp-grid">\${accounts.map(accountCard).join("") || metric("Next step", "Connect an account in SimplePost")}</div>
      </section>
    \`;
  }

  function renderValidation(data) {
    const accounts = data.accounts || [];
    const errors = accounts.flatMap((account) => (account.errors || []).map((issue) => ({ ...issue, account })));
    const warnings = accounts.flatMap((account) => (account.warnings || []).map((issue) => ({ ...issue, account })));
    setStatus(data.isValid ? "Valid" : "Needs edits", data.isValid ? "good" : "bad");
    content.innerHTML = \`
      <section class="sp-panel">
        <div class="sp-panel-header">
          <div>
            <h2 class="sp-panel-title">Validation result</h2>
            <div class="sp-panel-subtitle">\${text(accounts.length)} account\${accounts.length === 1 ? "" : "s"} checked.</div>
          </div>
          <span class="sp-badge" data-tone="\${data.isValid ? "good" : "bad"}">\${data.isValid ? "Ready" : "Blocked"}</span>
        </div>
        <div class="sp-grid">
          \${metric("Blocking errors", errors.length)}
          \${metric("Warnings", warnings.length)}
          \${metric("Platforms", (data.platforms || []).length)}
        </div>
      </section>
      <section class="sp-panel">
        <h2 class="sp-panel-title">Account checks</h2>
        <div class="sp-content" style="margin-top: 10px;">
          \${accounts.map((account) => \`
            <div class="sp-result">
              <div class="sp-row">
                <strong>\${text(account.displayName || account.username || platformLabel(account.platform))}</strong>
                <span class="sp-badge" data-tone="\${account.isValid ? "good" : "bad"}">\${account.isValid ? "OK" : "Fix"}</span>
              </div>
              <div class="sp-meta">\${text(platformLabel(account.platform))}</div>
            </div>
          \`).join("")}
        </div>
      </section>
      \${renderIssues("Errors", errors, "bad")}
      \${renderIssues("Warnings", warnings, "warn")}
    \`;
  }

  function renderIssues(title, issues, tone) {
    if (!issues.length) return "";
    return \`
      <section class="sp-panel">
        <h2 class="sp-panel-title">\${text(title)}</h2>
        <div class="sp-issues" style="margin-top: 10px;">
          \${issues.map((issue) => \`
            <div class="sp-issue" data-tone="\${tone === "bad" ? "bad" : "warn"}">
              <strong>\${text(platformLabel(issue.account?.platform))}</strong>
              <div>\${text(issue.message)}</div>
            </div>
          \`).join("")}
        </div>
      </section>
    \`;
  }

  function renderPreview(data) {
    const accounts = data.accounts || [];
    const valid = data.validation?.isValid;
    setStatus(valid ? "Preview ready" : "Preview blocked", valid ? "good" : "bad");
    content.innerHTML = \`
      <section class="sp-panel">
        <div class="sp-panel-header">
          <div>
            <h2 class="sp-panel-title">\${data.postingMode === "schedule" ? "Scheduled post preview" : "Publish-now preview"}</h2>
            <div class="sp-panel-subtitle">\${text(accounts.length)} target account\${accounts.length === 1 ? "" : "s"}.</div>
          </div>
          <span class="sp-badge" data-tone="\${valid ? "good" : "bad"}">\${valid ? "Ready" : "Fix first"}</span>
        </div>
        <div class="sp-meta">Scheduled for: \${text(data.scheduledFor)}</div>
        <p class="sp-message">\${text(data.message)}</p>
      </section>
      <section class="sp-panel">
        <h2 class="sp-panel-title">Targets</h2>
        <div class="sp-grid" style="margin-top: 10px;">\${accounts.map(accountCard).join("")}</div>
      </section>
      \${data.validation ? (() => {
        const validationAccounts = data.validation.accounts || [];
        const errors = validationAccounts.flatMap((account) => (account.errors || []).map((issue) => ({ ...issue, account })));
        const warnings = validationAccounts.flatMap((account) => (account.warnings || []).map((issue) => ({ ...issue, account })));
        return renderIssues("Errors", errors, "bad") + renderIssues("Warnings", warnings, "warn");
      })() : ""}
    \`;
  }

  function renderPost(data) {
    const post = data.post || {};
    const results = data.postingResults || [];
    const success = data.summary?.overallSuccess ?? post.status === "scheduled";
    setStatus(success ? "Completed" : "Partial failure", success ? "good" : "bad");
    content.innerHTML = \`
      <section class="sp-panel">
        <div class="sp-panel-header">
          <div>
            <h2 class="sp-panel-title">\${post.status === "scheduled" ? "Post scheduled" : "Publishing result"}</h2>
            <div class="sp-panel-subtitle">Post ID: \${text(post.id || "pending")}</div>
          </div>
          <span class="sp-badge" data-tone="\${success ? "good" : "bad"}">\${text(post.status || "unknown")}</span>
        </div>
        <div class="sp-meta">Scheduled for: \${text(post.scheduledFor || "")}</div>
        <p class="sp-message">\${text(post.message || data.message || "")}</p>
      </section>
      \${results.length ? \`
        <section class="sp-panel">
          <h2 class="sp-panel-title">Platform results</h2>
          <div class="sp-content" style="margin-top: 10px;">
            \${results.map((result) => \`
              <div class="sp-result">
                <div class="sp-row">
                  <strong>\${text(platformLabel(result.platform))}</strong>
                  <span class="sp-badge" data-tone="\${result.success ? "good" : "bad"}">\${result.success ? "Posted" : "Failed"}</span>
                </div>
                \${result.message ? \`<div class="sp-meta">\${text(result.message)}</div>\` : ""}
                \${result.postUrl ? \`<a class="sp-link" href="\${text(result.postUrl)}" target="_blank" rel="noopener noreferrer">\${text(result.postUrl)}</a>\` : ""}
              </div>
            \`).join("")}
          </div>
        </section>
      \` : ""}
    \`;
  }

  function render(payload) {
    const data = payload?.structuredContent || payload || {};
    if (data.kind === "accounts") return renderAccounts(data);
    if (data.kind === "validation") return renderValidation(data);
    if (data.kind === "preview") return renderPreview(data);
    if (data.kind === "post") return renderPost(data);
    setStatus("Unsupported", "warn");
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.method === "ui/notifications/tool-result") {
      render(message.params?.result || message.params);
    }
  }, { passive: true });
</script>
  `.trim();
}
