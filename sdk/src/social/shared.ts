import type {
  SocialActivityErrorCode,
  SocialActivityPage,
  SocialActivityResult,
  SocialPostMetrics,
} from "../types/social";

export const TIMEOUT_MS = 30_000;
export const MAX_PAGE_SIZE = 100;

export type JsonRecord = Record<string, unknown>;

export const record = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};

export const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export const string = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const numeric = (value: unknown): number | undefined => {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const pageLimit = (value?: number): number => Math.max(1, Math.min(value ?? 50, MAX_PAGE_SIZE));

export const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

export function failure<T>(platform: string, code: SocialActivityErrorCode, message: string): SocialActivityResult<T> {
  return { ok: false, error: { code, message: `${platform}: ${message}` } };
}

export function unsupported<T>(platform: string, capability: string): SocialActivityResult<T> {
  return failure(platform, "unsupported", `this connection does not provide ${capability}.`);
}

export function invalidResponse<T>(platform: string): SocialActivityResult<T> {
  return failure(platform, "invalid_response", "the provider returned an unexpected response.");
}

export function uncertainReply<T>(platform: string): SocialActivityResult<T> {
  return failure(
    platform,
    "uncertain",
    "the reply may have been accepted, but the provider did not return a usable result. Reconcile before sending again.",
  );
}

export function invalidRequest<T>(platform: string, message: string): SocialActivityResult<T> {
  return failure(platform, "invalid_request", message);
}

export function resultMetrics(
  nativePostId: string,
  values: Record<string, number>,
  coverage?: string,
): SocialActivityResult<SocialPostMetrics> {
  return {
    ok: true,
    data: {
      nativePostId,
      values,
      fetchedAt: new Date().toISOString(),
      ...(coverage ? { coverage } : {}),
    },
  };
}

/**
 * Provider cursors are server-issued opaque values. Reject URLs and control
 * characters so a cursor can never become an alternate request destination.
 */
export function safeCursor(value: string | undefined): string | undefined {
  if (
    !value ||
    value.length > 2048 ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    }) ||
    /^https?:/iu.test(value)
  )
    return undefined;
  return value;
}

export function page<T>(data: T[], nextCursor?: string, coverage?: string): SocialActivityPage<T> {
  const cursor = safeCursor(nextCursor);
  return { data, ...(cursor ? { nextCursor: cursor } : {}), ...(coverage ? { coverage } : {}) };
}

function errorCode(status: number, providerError?: JsonRecord): SocialActivityErrorCode {
  const code = providerError?.code;
  // Meta returns 190 for expired/revoked credentials and commonly uses 10,
  // 200, or 400 for capability/permission rejections.
  if (code === 190 || code === "190") return "authentication";
  if (code === 10 || code === 200 || code === 400 || code === "10" || code === "200" || code === "400")
    return "permission_required";
  if (typeof code === "string") {
    const normalized = code.toLowerCase();
    if (normalized.includes("scope") || normalized.includes("permission")) return "permission_required";
    if (normalized.includes("token") || normalized.includes("auth")) return "authentication";
    if (normalized.includes("rate") || normalized.includes("quota")) return "rate_limited";
  }
  if (status === 401) return "authentication";
  if (status === 403) return "permission_required";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "transient";
  return "invalid_response";
}

function messageFor(code: SocialActivityErrorCode): string {
  switch (code) {
    case "authentication": {
      return "the account needs to be reconnected.";
    }
    case "permission_required": {
      return "the connected account needs the required permission.";
    }
    case "not_found": {
      return "the requested post or activity was not found.";
    }
    case "rate_limited": {
      return "the provider rate limited this request. Try again later.";
    }
    case "transient": {
      return "the provider is temporarily unavailable. Try again.";
    }
    case "uncertain": {
      return "the request may have reached the provider. Reconcile before sending again.";
    }
    default: {
      return "the provider rejected this request.";
    }
  }
}

function isSuccessfulProviderError(value: JsonRecord): boolean {
  const code = value.code;
  return code === undefined || code === 0 || code === "0" || code === "ok" || code === "success";
}

function embeddedError(body: JsonRecord): JsonRecord | undefined {
  const value = body.error;
  if (!isRecord(value) || isSuccessfulProviderError(value)) return undefined;
  return value;
}

export interface JsonRequestResult {
  result: SocialActivityResult<JsonRecord>;
  /** Kept internal to adapters for DPoP nonce and response-header IDs. */
  response?: Response;
  body?: JsonRecord;
}

export interface JsonRequestOptions {
  /** Some provider reads (notably TikTok video/query) use POST. */
  isWrite?: boolean;
}

export interface JsonRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
}

/** Fetch JSON without allowing redirects or surfacing provider response bodies. */
export async function requestJson(
  platform: string,
  url: URL,
  init: JsonRequestInit = {},
  options: JsonRequestOptions = {},
): Promise<JsonRequestResult> {
  const isWrite = options.isWrite ?? (init.method ?? "GET").toUpperCase() !== "GET";
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return {
      result: isWrite
        ? failure(platform, "uncertain", "the request may have reached the provider. Reconcile before sending again.")
        : failure(platform, "transient", "the provider could not be reached. Try again."),
    };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return { response, result: isWrite ? uncertainReply(platform) : invalidResponse(platform) };
  }
  if (!isRecord(raw)) return { response, result: isWrite ? uncertainReply(platform) : invalidResponse(platform) };

  const body = raw;
  const errors = record(body.errors);
  const providerError = embeddedError(body) ?? (Object.keys(errors).length > 0 ? errors : undefined);
  if (!response.ok || providerError) {
    const code = isWrite && response.status >= 500 ? "uncertain" : errorCode(response.status, providerError);
    const retryAfter = Number(response.headers.get("retry-after"));
    return {
      response,
      body,
      result: {
        ok: false,
        error: {
          code,
          message: `${platform}: ${messageFor(code)}`,
          ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
        },
      },
    };
  }
  return { response, body, result: { ok: true, data: body } };
}

export function metaNext(body: JsonRecord): string | undefined {
  const paging = record(body.paging);
  // Meta includes `after` even on the final page. Its `next` URL includes the
  // access token, so retain only `after` and only when another page exists.
  return string(paging.next) ? safeCursor(string(record(paging.cursors).after)) : undefined;
}

export function trimmedReply(platform: string, text: string, maxLength: number): string | SocialActivityResult<never> {
  const value = text.trim();
  if (!value) return invalidRequest(platform, "a reply cannot be blank.");
  if (value.length > maxLength)
    return invalidRequest(platform, `a reply cannot exceed ${maxLength.toLocaleString("en-US")} characters.`);
  return value;
}

export function hasId(value: string, expression: RegExp): boolean {
  return expression.test(value) && value.length <= 512;
}

export function epochIso(value: unknown): string | undefined {
  const milliseconds = number(value);
  return milliseconds === undefined || milliseconds < 0 ? undefined : new Date(milliseconds).toISOString();
}
