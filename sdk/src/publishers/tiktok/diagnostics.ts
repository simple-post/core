export interface TikTokDiagnosticContext {
  [key: string]: unknown;
  phase: string;
  endpoint?: string;
  method?: string;
  publishMode?: string;
  mediaType?: string;
  publishId?: string;
  fileSize?: number;
  chunkSize?: number;
  totalChunks?: number;
  chunkIndex?: number;
  contentRange?: string;
  attempt?: number;
  attempts?: number;
  lastStatus?: string;
  pollErrors?: unknown[];
  lastResponse?: unknown;
}

const MAX_DIAGNOSTIC_CHARACTERS = 64 * 1024;
const MAX_DIAGNOSTIC_NODES = 2000;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Response data only: never serialize Axios config, requests, or outgoing headers. */
export function getTikTokErrorDetails(
  error: unknown,
  context: TikTokDiagnosticContext,
  secrets: readonly string[] = [],
): Record<string, unknown> {
  const source = record(error);
  const response = record(source.response);
  const body = response.data;
  const envelope = record(body);
  const providerError = typeof envelope.error === "object" ? record(envelope.error) : envelope;
  const code = typeof envelope.error === "string" ? envelope.error : providerError.code;
  const providerMessage = providerError.message ?? envelope.error_description;
  const responseHeaders = record(response.headers);
  const headerLogId = Object.entries(responseHeaders).find(([key]) =>
    ["x-tt-logid", "x-tt-log-id", "x-request-id"].includes(key.toLowerCase()),
  )?.[1];
  const logId = providerError.log_id ?? providerError.logid ?? envelope.log_id ?? headerLogId;
  const transport =
    error instanceof Error || source.code || source.message
      ? {
          name: source.name,
          code: source.code,
          message: source.message,
          stack: source.stack,
          cause: source.cause
            ? {
                name: record(source.cause).name,
                code: record(source.cause).code,
                message: record(source.cause).message,
              }
            : undefined,
          timeoutMs: typeof record(source.config).timeout === "number" ? record(source.config).timeout : undefined,
        }
      : undefined;

  let remaining = MAX_DIAGNOSTIC_CHARACTERS;
  let nodes = 0;
  let truncated = false;
  const ancestors = new WeakSet<object>();
  const redactText = (text: string): string => {
    let safe = text;
    for (const secret of secrets) if (secret) safe = safe.replaceAll(secret, "[REDACTED]");
    safe = safe
      .replaceAll(/\b(Bearer|Basic)\s+[^\s"'<>]+/gi, "$1 [REDACTED]")
      .replaceAll(/\b((?:authorization|set-cookie|cookie)\s*:\s*)[^\r\n]+/gi, "$1[REDACTED]")
      .replaceAll(/https?:\/\/[^\s"'<>]+/gi, (value) => {
        try {
          const url = new URL(value);
          url.username = "";
          url.password = "";
          return `${url.origin}${url.pathname}${url.search || url.hash ? "?[REDACTED]" : ""}`;
        } catch {
          return "[REDACTED URL]";
        }
      })
      .replaceAll(
        /((?:access[_-]?token|refresh[_-]?token|client[_-]?secret|upload[_-]?token|api[_-]?key|password|signature)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,
        "$1[REDACTED]",
      );
    if (safe.length > remaining) {
      safe = `${safe.slice(0, Math.max(0, remaining))}[TRUNCATED]`;
      truncated = true;
    }
    remaining = Math.max(0, remaining - safe.length);
    return safe;
  };
  const visit = (value: unknown, depth = 0): unknown => {
    if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
    if (++nodes > MAX_DIAGNOSTIC_NODES || depth > 12 || remaining <= 0) {
      truncated = true;
      return "[TRUNCATED]";
    }
    if (typeof value === "string") return redactText(value);
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "bigint") return redactText(String(value));
    if (value === null || typeof value !== "object") return value;
    if (Buffer.isBuffer(value)) return redactText(value.toString("utf8"));
    if (ancestors.has(value)) return "[Circular]";
    ancestors.add(value);
    try {
      const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
      const result: Record<string, unknown> = Object.create(null);
      const array: unknown[] = [];
      for (const [key, item] of entries) {
        if (nodes >= MAX_DIAGNOSTIC_NODES || remaining <= 0) {
          truncated = true;
          if (Array.isArray(value)) array.push("[TRUNCATED]");
          else result._truncated = true;
          break;
        }
        const name = String(key);
        const sensitive =
          /token|secret|password|authorization|cookie|signature|credential|uploadurl|apikey|privatekey|clientkey|accesskey/i.test(
            name.replaceAll(/[_-]/g, ""),
          );
        const safe = sensitive ? "[REDACTED]" : visit(item, depth + 1);
        if (Array.isArray(value)) array.push(safe);
        else if (safe !== undefined) result[redactText(name)] = safe;
      }
      return Array.isArray(value) ? array : result;
    } finally {
      ancestors.delete(value);
    }
  };

  const { pollErrors, lastResponse, ...location } = context;
  const details = visit({
    ...location,
    ...(response.status === undefined ? {} : { httpStatus: response.status }),
    ...(response.statusText === undefined ? {} : { httpStatusText: response.statusText }),
    ...(code === undefined ? {} : { code }),
    ...(logId === undefined ? {} : { logId }),
    ...(providerMessage === undefined ? {} : { providerMessage }),
    ...(transport ? { transport } : {}),
    ...(response.headers === undefined ? {} : { responseHeaders: response.headers }),
    ...(body === undefined ? {} : { providerResponse: body }),
    lastResponse,
    pollErrors,
  }) as Record<string, unknown>;
  if (truncated) details.diagnosticsTruncated = true;
  return details;
}
