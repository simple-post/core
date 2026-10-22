/** Timing policy only. Callers must establish that repeating the operation cannot publish twice. */
export function httpStatus(error: unknown): number | undefined {
  const err = error as { response?: { status?: unknown }; code?: unknown; statusCode?: unknown } | undefined;
  const status = err?.response?.status ?? err?.statusCode ?? err?.code;
  return typeof status === "number" && status >= 100 && status <= 599 ? status : undefined;
}

export function isTransientError(error: unknown): boolean {
  const status = httpStatus(error);
  if (status !== undefined) return [408, 429, 500, 502, 503, 504].includes(status);
  const err = error as { code?: unknown; requestError?: { code?: unknown } } | undefined;
  const code = err?.code ?? err?.requestError?.code;
  return (
    typeof code === "string" &&
    ["ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "ERR_NETWORK"].includes(code)
  );
}

function header(error: unknown, name: string): unknown {
  const headers =
    (error as { response?: { headers?: unknown }; headers?: unknown } | undefined)?.response?.headers ??
    (error as { headers?: unknown } | undefined)?.headers;
  if (!headers || typeof headers !== "object") return undefined;
  if ("get" in headers && typeof headers.get === "function") return headers.get(name);
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return Array.isArray(entry?.[1]) ? entry[1][0] : entry?.[1];
}

export function retryAfterMs(error: unknown): number | undefined {
  const raw = header(error, "retry-after");
  if (typeof raw === "string" || typeof raw === "number") {
    const text = String(raw).trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      const delay = Number(text) * 1000;
      if (Number.isFinite(delay)) return delay;
    } else {
      const date = Date.parse(text);
      if (Number.isFinite(date)) return Math.max(0, date - Date.now());
    }
  }
  // X uses an epoch reset time; Telegram returns a structured flood-control delay.
  if (httpStatus(error) === 429) {
    const seconds = (error as { response?: { data?: { parameters?: { retry_after?: unknown } } } })?.response?.data
      ?.parameters?.retry_after;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const reset = header(error, "x-rate-limit-reset");
    if (typeof reset === "string" && /^\d+$/.test(reset)) {
      const delay = Number(reset) * 1000 - Date.now();
      if (Number.isFinite(delay)) return Math.max(0, delay);
    }
  }
  return undefined;
}

/** Initial attempt plus two retries. Long provider waits are surfaced instead of shortened. */
export async function withTransientRetry<T>(
  operation: (remainingMs: number) => Promise<T>,
  options: { deadline?: number; shouldRetry?: (error: unknown) => boolean; maxDelayMs?: number } = {},
): Promise<T> {
  const deadline = options.deadline ?? Date.now() + 10 * 60_000;
  const delays = [1000, 3000];
  for (let attempt = 0; ; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Operation deadline exceeded.");
    try {
      return await operation(remaining);
    } catch (error) {
      const backoff = delays[attempt];
      if (backoff === undefined || !(options.shouldRetry ?? isTransientError)(error)) throw error;
      const delay = Math.max(backoff, retryAfterMs(error) ?? 0);
      if (delay > (options.maxDelayMs ?? 30_000) || delay >= deadline - Date.now()) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
