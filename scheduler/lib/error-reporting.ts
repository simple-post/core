// Simple error reporting contract v1. Keep this contract synchronized across products.
// Server only: credentials and exception stacks must never enter browser bundles.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type ErrorContext = Record<string, unknown>;
export type ErrorReport = {
  id: string;
  timestamp: string;
  severity: "error" | "fatal";
  summary: string;
  attributes: Record<string, string | number | boolean>;
};
const contextStorage = new AsyncLocalStorage<ErrorContext>();
const pending = new Set<Promise<void>>();

export function withErrorContext<T>(context: ErrorContext, work: () => T): T {
  return contextStorage.run({ ...contextStorage.getStore(), ...context }, work);
}
export function addErrorContext(context: ErrorContext): void {
  const current = contextStorage.getStore();
  if (current) Object.assign(current, context);
}

/** Keep diagnostic prose and complete stacks, but remove bearer credentials. */
export function sanitizeDiagnostic(value: string): string {
  return value
    .replaceAll(/(https?:\/\/)[^/\s@]+@/gi, "$1[REDACTED]@")
    .replaceAll(/(https?:\/\/[^\s?\u0022'<>#]+)[?#][^\s\u0022'<>]*/gi, "$1?[REDACTED]")
    .replaceAll(/(api\.telegram\.org\/bot)[^/\s]+/gi, "$1[REDACTED]")
    .replaceAll(/Bearer\s+[^\s\u0022'<>]+/gi, "Bearer [REDACTED]")
    .replaceAll(/\b(?:sk|re)[_-][A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replaceAll(
      /((?:password|secret|token|client_secret|access_token|refresh_token|api_key|apiKey|authorization|cookie)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .replaceAll(/(\/(?:feed|rss|share|reset-password|verify-email)\/)[A-Za-z0-9_-]{16,}/gi, "$1[REDACTED]");
}
const short = (value: unknown, size = 250) => sanitizeDiagnostic(String(value)).replaceAll(/\s+/g, " ").slice(0, size);
const object = (value: unknown): ErrorContext => (value && typeof value === "object" ? (value as ErrorContext) : {});

/** Only selected diagnostic fields leave the process; never bodies, headers or tool arguments. */
const fields: Record<string, string[]> = {
  "error.area": ["area", "module", "scope", "functionName", "context", "event"],
  "user.id": ["userId", "user.id", "enduser.id"],
  "user.email": ["userEmail", "user.email"],
  "geo.country": ["country", "countryCode", "geo.country"],
  "client.surface": ["surface", "client.surface", "postingSource", "source"],
  "client.agent": ["agent", "client.agent", "clientName"],
  "request.id": ["requestId", "request.id"],
  "http.request.method": ["method", "requestMethod"],
  "url.path": ["path", "requestPath"],
  "http.response.status_code": ["status", "statusCode", "httpStatus", "http.status_code"],
  "mcp.tool": ["toolName", "tool", "rpcMethod"],
  "job.id": ["jobId", "episodeId", "episode.id"],
  "post.id": ["postId"],
  "account.id": ["accountId"],
  platform: ["platform"],
  "retry.scheduled": ["willRetry", "retry.scheduled"],
  "retry.attempt": ["attempt"],
  "failure.stage": ["stage", "failure.stage"],
  "failure.code": ["code", "failure.code"],
  trace_id: ["traceId", "trace_id"],
  span_id: ["spanId", "span_id"],
  "support.id": ["supportId"],
  "account.handle": ["accountHandle", "accountUsername"],
  "job.generation": ["generation"],
  "job.revision": ["revision"],
  "chunk.index": ["chunkIndex", "chunk.index"],
  "chunk.count": ["chunkCount", "chunk.count"],
  "chunk.completed": ["completedChunks", "chunk.completed"],
  "retry.delay_seconds": ["retryDelaySeconds", "retry.delay_seconds"],
  "provider.code": ["providerCode", "provider.code"],
};

export function buildErrorReport(product: string, error: unknown, input: ErrorContext = {}): ErrorReport {
  const context = { ...contextStorage.getStore(), ...input };
  const source = object(error);
  const actor = object(context.actor);
  context.userId ??= actor.id;
  context.userEmail ??= actor.email;
  const severity = context.severity === "fatal" ? "fatal" : "error";
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const message = sanitizeDiagnostic(
    typeof source.message === "string"
      ? source.message
      : typeof error === "string"
        ? error
        : typeof context.message === "string"
          ? context.message
          : "Unknown error",
  );
  const attributes: ErrorReport["attributes"] = {
    "error.schema_version": 1,
    "error.id": id,
    "product.name": product,
    "exception.type": short(source.name || source.type || "Error"),
    "exception.message": message,
  };
  for (const [key, aliases] of Object.entries(fields)) {
    const value = aliases
      .map((alias) => context[alias])
      .find((value) => value !== undefined && value !== null && value !== "");
    if (typeof value === "string") attributes[key] = short(key === "url.path" ? value.split(/[?#]/)[0] : value);
    else if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))
      attributes[key] = value;
  }
  // Stack length is deliberately unlimited. Redaction must not remove frames.
  if (typeof source.stack === "string") attributes["exception.stacktrace"] = sanitizeDiagnostic(source.stack);
  const seen = new Set<unknown>([error]);
  let cause = source.cause;
  const causes: string[] = [];
  while (cause && !seen.has(cause)) {
    seen.add(cause);
    const nested = object(cause);
    causes.push(
      sanitizeDiagnostic(
        typeof nested.stack === "string"
          ? nested.stack
          : typeof nested.message === "string"
            ? nested.message
            : typeof cause === "string"
              ? cause
              : "Unknown cause",
      ),
    );
    cause = nested.cause;
  }
  if (causes.length > 0) attributes["exception.cause"] = causes.join("\nCaused by: ");
  for (const [key, value] of Object.entries(context)) {
    if (
      /^fidelity\.(source_tokens|transcript_tokens|first_mismatch|segment_offset|segment_length|recovery_depth)$/.test(
        key,
      ) &&
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    )
      attributes[key] = value;
  }
  const environment =
    process.env.APP_ENV || process.env.OTEL_DEPLOYMENT_ENVIRONMENT || process.env.NODE_ENV || "development";
  attributes["deployment.environment.name"] = environment;
  attributes["error.attention"] =
    severity === "fatal" ? "immediate" : attributes["retry.scheduled"] === true ? "retrying" : "investigate";
  const value = (key: string) => attributes[key] ?? "unknown";
  const lines = [
    `${product} · ${severity.toUpperCase()} · ${attributes["error.attention"]}`,
    `Error: ${short(message, 700)}`,
    `Area: ${value("error.area")}`,
    `User: ${value("user.email")}${attributes["user.id"] ? ` (${value("user.id")})` : ""}`,
    `Country: ${value("geo.country")} · Client: ${value("client.surface")} · Agent: ${value("client.agent")}`,
    `Environment: ${environment} · Time: ${timestamp}`,
  ];
  if (context.message && context.message !== message) lines.push(`Operation: ${short(context.message, 300)}`);
  for (const [key, label] of Object.entries({
    "request.id": "Request",
    "url.path": "Path",
    "http.response.status_code": "HTTP",
    "mcp.tool": "Tool",
    "job.id": "Job",
    "post.id": "Post",
    "account.id": "Account",
    "account.handle": "Handle",
    platform: "Platform",
    "retry.attempt": "Attempt",
    "failure.stage": "Stage",
    "failure.code": "Code",
    trace_id: "Trace",
  })) {
    if (attributes[key] !== undefined) lines.push(`${label}: ${attributes[key]}`);
  }
  lines.push(`Report: ${id}`);
  return { id, timestamp, severity, summary: boundedSummary(lines, id), attributes };
}

function formatTelegramReport(report: ErrorReport): string {
  const escaped = (value: string | number | boolean, limit: number) => {
    const characters = Array.from(String(value).replace(/\s+/g, " ").trim());
    const text = characters.length > limit ? characters.slice(0, limit - 1).join("") + "…" : characters.join("");
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  };
  const { attributes } = report;
  const value = (key: string, limit = 100) => {
    const field = attributes[key];
    return field === undefined || field === "unknown" ? "" : escaped(field, limit);
  };
  const group = (...parts: string[]) => parts.filter(Boolean).join(" · ");
  const status =
    report.severity === "fatal"
      ? { icon: "🔴", label: "Act now" }
      : attributes["retry.scheduled"] === true
        ? { icon: "🔁", label: "Retrying" }
        : { icon: "⚠️", label: "Investigate" };
  const product = value("product.name", 80) || "Simple";
  const error = value("exception.message", 500) || "Unknown error";
  const path = value("url.path", 160);
  const http = value("http.response.status_code", 12);
  const attempt = value("retry.attempt", 20);
  const environment = value("deployment.environment.name", 40);
  const rows = [
    ["Where", group(value("error.area"), path && `<code>${path}</code>`, http && `HTTP ${http}`)],
    ["User", value("user.email", 180) || value("user.id")],
    ["Client", group(value("client.surface"), value("client.agent"), value("geo.country", 20))],
    ["Tool", value("mcp.tool")],
    ["Job", value("job.id")],
    ["Post", group(value("post.id"), value("platform"), value("account.handle"))],
    ["Details", group(value("failure.stage"), value("failure.code"), attempt && `attempt ${attempt}`)],
    ["Environment", environment === "production" ? "" : environment],
  ];
  let text = `${status.icon} <b>${product}</b> · ${status.label}\n\n<b>${error}</b>\n`;
  const footer = `\n\n<b>Report</b>  <code>${escaped(report.id, 80)}</code>`;
  // Budget whole rows so truncation never splits an HTML tag or entity.
  for (const [label, details] of rows) {
    if (!details) continue;
    const row = `\n<b>${label}</b>  ${details}`;
    if (text.length + row.length + footer.length <= 3900) text += row;
  }
  return text.trimEnd() + footer;
}

function boundedSummary(lines: string[], id: string): string {
  const text = lines.join("\n");
  if (text.length <= 3900) return text;
  const footer = `\nMore context in SigNoz.\nReport: ${id}`;
  return text.slice(0, 3900 - footer.length - 1) + "…" + footer;
}

type HeaderSource = Headers | Record<string, string | string[] | undefined>;
export function requestErrorContext(headers: HeaderSource, path = "", method?: string): ErrorContext {
  const get = (name: string) => {
    if (headers instanceof Headers) return headers.get(name) || "";
    const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
    return Array.isArray(value) ? value[0] || "" : value || "";
  };
  const ua = get("user-agent");
  const country = get("cf-ipcountry") || get("x-vercel-ip-country");
  // Explicit client labels are diagnostic hints, never authentication or authorization.
  const explicit = get("x-simple-client");
  const surface = /\/mcp(?:[/?-]|$)/.test(path)
    ? "mcp"
    : ["web", "mobile", "api", "cli"].includes(explicit)
      ? explicit
      : /CFNetwork|okhttp|SimpleMuscle|SimplePhotoGallery/i.test(ua)
        ? "mobile"
        : /Mozilla\//.test(ua)
          ? "web"
          : ua
            ? "api"
            : "unknown";
  const agent = /claude|anthropic/i.test(ua)
    ? "Claude"
    : /chatgpt|openai/i.test(ua)
      ? "ChatGPT"
      : /codex/i.test(ua)
        ? "Codex"
        : /grok/i.test(ua)
          ? "Grok"
          : /hermes/i.test(ua)
            ? "Hermes"
            : /Chrome\//.test(ua)
              ? "Chrome"
              : /Safari\//.test(ua)
                ? "Safari"
                : /Firefox\//.test(ua)
                  ? "Firefox"
                  : "unknown";
  return {
    path: path.split(/[?#]/)[0],
    method,
    requestId: randomUUID(),
    surface,
    agent,
    country: /^[A-Z]{2}$/.test(country) && !["XX", "T1"].includes(country) ? country : "unknown",
  };
}

type DeliveryOptions = {
  service: string;
  /** Existing OTEL logger adapter; absent uses standard OTLP/HTTP JSON. */
  emit?: (report: ErrorReport) => void | Promise<void>;
  /** Auto-instrumented apps supply an OpenTelemetry suppressTracing wrapper. */
  withoutTracing?: <T>(work: () => T) => T;
};
async function post(url: string, body: unknown, headers: Record<string, string> = {}, telegram = false): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    let result: {
      ok?: boolean;
      parameters?: { retry_after?: number };
      partialSuccess?: { rejectedLogRecords?: string | number };
    };
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(4000),
      });
      result = await response.json().catch(() => ({}));
    } catch {
      if (attempt === 1) throw new Error("Error report delivery failed");
      continue;
    }
    if (response.ok && (!telegram || result.ok !== false) && !Number(result.partialSuccess?.rejectedLogRecords)) return;
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      const delay = Number(result.parameters?.retry_after || response.headers.get("retry-after") || 0.25) * 1000;
      if (Number.isFinite(delay) && delay <= 2000) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, delay)));
        continue;
      }
    }
    throw new Error(`Delivery rejected (${response.status})`);
  }
}
function otlpHeaders(): Record<string, string> {
  const pairs = process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS || process.env.OTEL_EXPORTER_OTLP_HEADERS || "";
  return Object.fromEntries(
    pairs.split(",").flatMap((pair) => {
      const index = pair.indexOf("=");
      if (index < 1) return [];
      try {
        return [[pair.slice(0, index).trim(), decodeURIComponent(pair.slice(index + 1).trim())]];
      } catch {
        return [];
      }
    }),
  );
}
function otlpAttributes(attributes: ErrorReport["attributes"]) {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value:
      typeof value === "boolean"
        ? { boolValue: value }
        : typeof value === "number"
          ? { doubleValue: value }
          : { stringValue: value },
  }));
}
async function exportLog(report: ErrorReport, service: string): Promise<void> {
  if (["true", "1"].includes(process.env.OTEL_SDK_DISABLED || "") || process.env.OTEL_LOGS_EXPORTER === "none") return;
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ||
    (process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "")}/v1/logs`
      : "");
  if (!endpoint) return;
  const resource = {
    "service.name": process.env.OTEL_SERVICE_NAME || service,
    "service.version": process.env.OTEL_SERVICE_VERSION || process.env.SOURCE_COMMIT || "unknown",
    "deployment.environment": report.attributes["deployment.environment.name"],
    "deployment.environment.name": report.attributes["deployment.environment.name"],
  };
  await post(
    endpoint,
    {
      resourceLogs: [
        {
          resource: { attributes: otlpAttributes(resource) },
          scopeLogs: [
            {
              scope: { name: "simple.error-reporting", version: "1" },
              logRecords: [
                {
                  timeUnixNano: String(BigInt(Date.parse(report.timestamp)) * BigInt(1_000_000)),
                  severityNumber: report.severity === "fatal" ? 21 : 17,
                  severityText: report.severity.toUpperCase(),
                  body: { stringValue: report.summary },
                  attributes: otlpAttributes(report.attributes),
                  ...(/^[a-f0-9]{32}$/.test(String(report.attributes.trace_id))
                    ? { traceId: report.attributes.trace_id }
                    : {}),
                  ...(/^[a-f0-9]{16}$/.test(String(report.attributes.span_id))
                    ? { spanId: report.attributes.span_id }
                    : {}),
                },
              ],
            },
          ],
        },
      ],
    },
    otlpHeaders(),
  );
}

/** Start both destinations now. Neither failure can prevent the other delivery. */
export function sendErrorReport(report: ErrorReport, options: DeliveryOptions): Promise<void> {
  const run = options.withoutTracing || (<T>(work: () => T): T => work());
  const deliver = async (destination: string, work: () => void | Promise<void>) => {
    try {
      await run(work);
    } catch {
      console.warn(JSON.stringify({ event: "error_report_delivery_failed", destination, reportId: report.id }));
    }
  };
  const task = Promise.all([
    deliver("signoz", () => (options.emit ? options.emit(report) : exportLog(report, options.service))),
    deliver("telegram", async () => {
      const token = process.env.LOG_TELEGRAM_BOT_TOKEN;
      const chatId = process.env.LOG_TELEGRAM_CHAT_ID;
      if (!token || !chatId || process.env.LOG_TELEGRAM_DISABLED === "true") return;
      await post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          chat_id: chatId,
          text: formatTelegramReport(report),
          parse_mode: "HTML",
          disable_web_page_preview: true,
        },
        {},
        true,
      );
    }),
  ]).then(() => {});
  pending.add(task);
  void task.finally(() => pending.delete(task));
  return task;
}

export async function flushErrorReports(): Promise<void> {
  await Promise.allSettled(pending);
}
