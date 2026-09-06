import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { aggregateJournal, type AggregateAttempt } from "./aggregate.js";
import { catalog, materialize } from "./catalog.js";
import type { LiveConfig } from "./config.js";
import type { Interface, Scenario } from "./types.js";
import { digest } from "./journal.js";
import { redact } from "./redact.js";

const reportInterfaces: Interface[] = ["ui", "mcp", "cli-app"];
export function reportRows(config: LiveConfig, attempts: AggregateAttempt[], scenarios = catalog) {
  return scenarios.flatMap((s: Scenario) =>
    reportInterfaces.map((iface) => {
      const account = config.accounts[s.platform];
      const history = attempts
        .filter((a) => a.scenarioId === s.id && a.interface === iface)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const current = history.filter((a) => a.currentDefinition && a.accountId === account?.id);
      const latest = current[0];
      const passed = current.find((a) => a.phase === "verified");
      const excluded = !account;
      const unsupported = !!s.unsupportedReason || !s.interfaces.includes(iface);
      const status = excluded
        ? "Excluded"
        : unsupported
          ? "Unsupported"
          : latest?.phase === "verified"
            ? "Passed"
            : passed
              ? "Passed previously"
              : latest
                ? latest.phase
                : "Not run";
      let specification: unknown = s;
      let setupError: string | undefined;
      if (account) {
        try {
          const m = materialize(s, account, iface, "aggregate-current", config.mediaBaseUrl, config.fixtureUrls);
          specification = {
            media: m.media,
            input: m.input ?? "default",
            mode: m.mode ?? "now",
            options: m.options,
            omittedOptions: m.omitOptions,
            message: m.message,
            expectedText: m.expectedText,
            expectedTitle: m.expectedTitle,
            expectedFields: m.expectedFields,
            expectedRejection: m.expectedError,
            requirements: m.requirements,
            thread: m.thread,
          };
        } catch (e) {
          setupError = (e as Error).message;
        }
      }
      return {
        platform: s.platform,
        scenario: s.id,
        interface: iface,
        status,
        eligible: !excluded && !unsupported,
        verified: !!passed && !excluded && !unsupported,
        reason: excluded
          ? "No account configured; outside this report's completion scope."
          : unsupported
            ? (s.unsupportedReason ?? "Not supported through this interface.")
            : (latest?.error ?? setupError ?? ""),
        account: account?.username ?? "",
        specification,
        latest,
        passed,
        history,
      };
    }),
  );
}
type ReportRow = ReturnType<typeof reportRows>[number];
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
const json = (value: unknown) => escape(redact(JSON.stringify(value, null, 2)));
const csvCell = (value: unknown) => {
  let text = redact(String(value ?? ""));
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
export function reportCsv(rows: ReportRow[]) {
  return (
    [
      [
        "Platform",
        "Scenario",
        "Interface",
        "Status",
        "In scope",
        "Latest run",
        "Verified run",
        "Reason",
        "Specification",
      ],
      ...rows.map((r) => [
        r.platform,
        r.scenario,
        r.interface,
        r.status,
        r.eligible,
        r.latest?.run,
        r.passed?.run,
        r.reason,
        JSON.stringify(r.specification),
      ]),
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n") + "\r\n"
  );
}
export function reportHtml(
  rows: ReportRow[],
  generatedAt: string,
  reportExists: (run: string) => boolean = () => true,
) {
  const scope = rows.filter((r) => r.eligible);
  const verified = scope.filter((r) => r.verified).length;
  const latestPassed = scope.filter((r) => r.status === "Passed").length;
  const platformNames = [...new Set(rows.map((r) => r.platform))].sort();
  const statuses = [...new Set(rows.map((r) => r.status))].sort();
  const runLink = (a: AggregateAttempt) => {
    const run = encodeURIComponent(a.run);
    return `${reportExists(a.run) ? `<a href="${run}/html/index.html" target="_blank" rel="noopener">Run report</a> · ` : ""}<a href="${run}/${digest(a.key)}.json" target="_blank" rel="noopener">Journal</a>`;
  };
  const platformRows = platformNames
    .map((p) => {
      const scoped = scope.filter((r) => r.platform === p);
      return `<tr><td><button class="platform" data-platform="${p}">${p}</button></td>${reportInterfaces
        .map((i) => {
          const cells = scoped.filter((r) => r.interface === i);
          return `<td>${cells.filter((r) => r.verified).length} / ${cells.length}</td>`;
        })
        .join("")}<td>${scoped.filter((r) => r.verified).length} / ${scoped.length}</td></tr>`;
    })
    .join("");
  const body = rows
    .map(
      (
        r,
      ) => `<tr data-platform="${r.platform}" data-interface="${r.interface}" data-status="${escape(r.status)}" data-scope="${r.eligible}">
    <td>${r.platform}</td><td><strong>${escape(r.scenario)}</strong><details><summary>What this case checks</summary><pre>${json(r.specification)}</pre></details></td>
    <td>${r.interface}</td><td><span class="badge ${r.status === "Passed" ? "pass" : r.status === "Not run" ? "muted" : "other"}">${escape(r.status)}</span></td>
    <td>${r.latest ? `${escape(r.latest.updatedAt)}<br><small>${escape(r.latest.revision ?? "Revision not recorded")}</small>` : "—"}</td>
    <td>${r.passed ? `<div>Verified: ${escape(r.passed.run)}<br>${runLink(r.passed)}</div>` : ""}${r.reason ? `<p class="reason">${escape(redact(r.reason))}</p>` : ""}
    <details><summary>Attempts and receipts (${r.history.length})</summary>${r.history.map((a) => `<section><strong>${escape(a.phase)}</strong> · ${escape(a.run)}<br>${escape(a.updatedAt)} · ${a.currentDefinition ? "Current account and case definition" : "Historical account or case definition — excluded from current coverage"}<br>${runLink(a)}<pre>${json({ receipt: a.receipt, error: a.error, historicalErrors: a.historicalErrors, revision: a.revision })}</pre></section>`).join("") || "No saved attempts."}</details></td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SimplePost · All-platform test report</title>
  <style>:root{font-family:system-ui,sans-serif;color:#172b33;background:#f5f7f7}body{margin:0;padding:32px;max-width:1600px;margin:auto}h1{margin-bottom:8px}p{line-height:1.5}.note{max-width:1000px;color:#52656c}.metrics{display:flex;gap:16px;margin:24px 0}.metric{padding:18px 24px;background:white;border:1px solid #d7e2e4;border-radius:10px}.metric strong{display:block;font-size:28px}.filters{display:flex;gap:12px;flex-wrap:wrap;padding:16px 0;position:sticky;top:0;background:#f5f7f7;z-index:1}input,select{padding:10px;border:1px solid #b6c6ca;border-radius:6px;font:inherit}input[type=search]{min-width:300px}table{border-collapse:collapse;width:100%;background:white}th,td{border-bottom:1px solid #dde5e7;padding:12px;text-align:left;vertical-align:top}th{background:#eaf0f1;font-size:13px}small{color:#61757e}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-width:650px;background:#f1f5f5;padding:12px}details{margin-top:10px}summary{cursor:pointer;color:#286c7a}section{border-top:1px solid #cddbdd;margin-top:12px;padding-top:12px}.badge{white-space:nowrap;padding:4px 8px;border-radius:4px;font-size:12px}.pass{background:#d9f0e2;color:#155c36}.muted{background:#edf0f2;color:#586772}.other{background:#fff0d6;color:#78551c}a{color:#126579}.reason{max-width:440px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.platform{border:0;background:none;color:#126579;font:inherit;cursor:pointer;text-decoration:underline}#summary{max-width:750px}#cases{font-size:13px}[hidden]{display:none!important}</style></head><body>
  <h1>All-platform test report</h1><p class="note">Generated ${escape(generatedAt)} from local saved runs. UI, MCP and CLI-app are included. Accounts not configured and unsupported combinations are shown separately; CLI-local is outside this report.</p>
  <div class="metrics"><div class="metric"><strong>${verified} / ${scope.length}</strong>cases with verified evidence</div><div class="metric"><strong>${scope.length - verified}</strong>incomplete cases</div><div class="metric"><strong>${latestPassed}</strong>latest attempts passed</div></div>
  <p class="note">Results span several deployments; this is not a claim that every case ran against today's build. A pass belongs to the exact account and case definition. Earlier failures remain in the history. “Passed previously” means a later attempt did not pass. Rejections and cancellations are successful tests without an external post. Specifications use a sample run marker; journals show the exact submitted text and options. Open a run report for screenshots and detailed Playwright assertions; journals contain durable receipts.</p>
  <p><a href="aggregate.csv" download>Download all rows as CSV</a> · <a href="aggregate.json">Raw aggregate JSON</a></p>
  <table id="summary"><thead><tr><th>Platform</th><th>UI</th><th>MCP</th><th>CLI-app</th><th>Verified / supported</th></tr></thead><tbody>${platformRows}</tbody></table>
  <div class="filters"><input id="search" type="search" aria-label="Search cases" placeholder="Search scenarios, options, errors…"><select id="platform" aria-label="Platform"><option value="">All platforms</option>${platformNames.map((p) => `<option>${p}</option>`).join("")}</select><select id="interface" aria-label="Interface"><option value="">All interfaces</option>${reportInterfaces.map((i) => `<option>${i}</option>`).join("")}</select><select id="status" aria-label="Status"><option value="">All statuses</option>${statuses.map((s) => `<option>${escape(s)}</option>`).join("")}</select><label><input id="excluded" type="checkbox"> Include unsupported / excluded</label></div>
  <p id="visible" aria-live="polite"></p><table id="cases"><thead><tr><th>Platform</th><th>Scenario and specification</th><th>Interface</th><th>Status</th><th>Latest attempt (UTC)</th><th>Evidence and history</th></tr></thead><tbody>${body}</tbody></table>
  <script>const controls=['search','platform','interface','status','excluded'].map(id=>document.getElementById(id));const rows=Array.from(document.querySelectorAll('#cases tbody tr'));const searchText=rows.map(r=>r.textContent.toLowerCase());function filter(){const[q,p,i,s,e]=controls;let count=0;rows.forEach((r,n)=>{const visible=(e.checked||r.dataset.scope==='true')&&(!p.value||r.dataset.platform===p.value)&&(!i.value||r.dataset.interface===i.value)&&(!s.value||r.dataset.status===s.value)&&searchText[n].includes(q.value.toLowerCase());r.hidden=!visible;if(visible)count++});document.getElementById('visible').textContent=count+' cases shown';}controls.forEach(c=>c.addEventListener('input',filter));document.querySelectorAll('.platform').forEach(b=>b.addEventListener('click',()=>{controls[1].value=b.dataset.platform;filter()}));filter();</script></body></html>`;
}
export async function writeAggregateReport(config: LiveConfig) {
  await mkdir(config.runDir, { recursive: true, mode: 0o700 });
  const aggregate = await aggregateJournal(config);
  const rows = reportRows(config, aggregate.attempts);
  await writeFile(
    path.join(config.runDir, "index.html"),
    reportHtml(rows, aggregate.generatedAt, (run) => existsSync(path.join(config.runDir, run, "html", "index.html"))),
    { mode: 0o600 },
  );
  await writeFile(path.join(config.runDir, "aggregate.csv"), reportCsv(rows), { mode: 0o600 });
  return config.runDir;
}
