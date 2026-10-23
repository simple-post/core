import { once } from "node:events";
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

import axios from "axios";

import { PostError, PostErrorType } from "../../types";

/**
 * YouTube videos.insert over the resumable upload protocol:
 * https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol
 *
 * One session per call, never replaced. Once media bytes may have reached
 * YouTube, every unresolved outcome is API_ERROR so the caller reconciles
 * instead of reposting; nothing here can create a second video. Errors carry
 * fixed messages and bounded codes only: never provider text, request headers
 * or the session URL.
 */

export const YOUTUBE_UPLOAD_ORIGIN = "https://www.googleapis.com";
const UPLOAD_PATH = "/upload/youtube/v3/videos";
const INIT_URL = `${YOUTUBE_UPLOAD_ORIGIN}${UPLOAD_PATH}?uploadType=resumable&part=snippet,status`;

/** Local backoff before each recovery of the same session; the length is the recovery budget. */
const RECOVERY_DELAYS_MS = [1000, 3000];
const CONTROL_TIMEOUT_MS = 30_000;
const ASSUMED_RATE_BYTES_PER_SEC = 512 * 1024;
const RESPONSE_LIMIT_BYTES = 1024 * 1024;
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
/** videos.insert reason codes allowed into diagnostics; anything else is dropped. */
const KNOWN_REASONS = new Set([
  "authError",
  "backendError",
  "badRequest",
  "dailyLimitExceeded",
  "forbidden",
  "insufficientPermissions",
  "invalidCategoryId",
  "invalidDescription",
  "invalidFilename",
  "invalidPublishAt",
  "invalidTags",
  "invalidTitle",
  "invalidVideoMetadata",
  "mediaBodyRequired",
  "quotaExceeded",
  "rateLimitExceeded",
  "uploadLimitExceeded",
  "userRateLimitExceeded",
  "youtubeSignupRequired",
]);

const SAFE_TO_RETRY = "YouTube rejected the video upload before any video was created. It is safe to retry.";
const AMBIGUOUS =
  "YouTube did not confirm the video upload. The video may exist on the channel; check YouTube Studio before reposting.";
const CREDENTIALS = "Your YouTube connection has expired. Please reconnect your YouTube account in Settings.";
const UPLOAD_LIMIT =
  "YouTube rejected this upload because the channel's upload limit is exhausted. Try again after YouTube restores the allowance. No video was created by this attempt.";
const UNREADABLE_FILE = "The video file could not be read. No video was created by this attempt.";
const UNTRUSTED_SESSION = "YouTube returned an unexpected upload session. No video was created by this attempt.";

export interface YouTubeUploadInput {
  filePath: string;
  size: number;
  metadata: {
    snippet: { title: string; description?: string; tags?: string[]; categoryId?: string };
    status: { privacyStatus?: string; publishAt?: string; selfDeclaredMadeForKids: boolean };
  };
  /** Current `Authorization` header value; the OAuth2 client refreshes transparently. */
  getAuthorization: () => Promise<string>;
  logger?: { info: (message: string) => void; warn: (message: string) => void };
}

export interface YouTubeUploadResult {
  videoId: string;
  /** `status.uploadStatus` from the final response, when present. */
  uploadStatus?: string;
}

interface Response {
  status: number;
  headers: Record<string, unknown>;
  data: unknown;
}

/** Exactly the Google upload endpoint over HTTPS, without credentials, port or fragment. */
export function isTrustedSessionUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname === "www.googleapis.com" &&
    url.pathname === UPLOAD_PATH &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    url.hash === ""
  );
}

/**
 * Next byte offset from a 308 `Range` header (`bytes=0-N`). Undefined when the
 * header is malformed, exceeds the file, or regresses below bytes the session
 * already acknowledged, including a missing header after progress.
 */
export function parseAcknowledgedBytes(range: unknown, size: number, previous: number): number | undefined {
  if (range === undefined || range === null || range === "") return previous === 0 ? 0 : undefined;
  const match = typeof range === "string" ? /^bytes=0-(\d{1,15})$/.exec(range.trim()) : null;
  if (!match) return;
  const next = Number(match[1]) + 1;
  return next <= size && next >= previous ? next : undefined;
}

/** Retry-After in milliseconds: delta seconds of any length (never read as a date) or an HTTP-date. */
export function parseRetryAfterMs(value: unknown, now: number): number | undefined {
  if (typeof value !== "string") return;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const date = Date.parse(text);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

const header = (response: Response, name: string): unknown => {
  const value = response.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

const knownReasons = (data: unknown): string[] => {
  const issues = (data as { error?: { errors?: { reason?: unknown }[] } } | null | undefined)?.error?.errors;
  return (Array.isArray(issues) ? issues : [])
    .map((issue) => issue?.reason)
    .filter((reason): reason is string => typeof reason === "string" && KNOWN_REASONS.has(reason))
    .slice(0, 5);
};

/** A credential provider failure that no retry can fix. */
const isRevoked = (error: unknown): boolean => {
  const failure = error as
    | { message?: unknown; response?: { status?: number; data?: { error?: unknown } } }
    | null
    | undefined;
  const code = failure?.response?.data?.error ?? failure?.message;
  return failure?.response?.status === 401 || code === "invalid_grant" || code === "invalid_client";
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** Axios bounds the whole request, so a PUT gets time for its bytes at a modest sustained rate. */
const putTimeoutMs = (bytes: number) => clamp(Math.ceil(bytes / ASSUMED_RATE_BYTES_PER_SEC) * 1000, 120_000, 7_200_000);

export async function uploadYouTubeVideo(input: YouTubeUploadInput): Promise<YouTubeUploadResult> {
  const { filePath, size, metadata, getAuthorization } = input;
  const log: NonNullable<YouTubeUploadInput["logger"]> = input.logger ?? { info: () => {}, warn: () => {} };
  if (!Number.isSafeInteger(size) || size <= 0)
    throw new PostError(PostErrorType.INVALID_CONTENT, "YouTube requires a nonempty video file.");

  // Wall-clock bound across init, every PUT, every backoff and every status query.
  const deadline = Date.now() + clamp(3 * putTimeoutMs(size), 600_000, 10_800_000);
  const remaining = () => deadline - Date.now();
  let stage: "init" | "upload" | "recover" = "init";
  /** True once any media byte may have reached YouTube. */
  let transmitted = false;
  const fail = (type: PostErrorType, message: string, details: Record<string, unknown>) =>
    new PostError(type, message, { stage, ...details });
  const ambiguous = (code: string, httpStatus?: number) =>
    fail(PostErrorType.API_ERROR, AMBIGUOUS, { code, httpStatus });

  /** One request with fresh credentials. Resolves for every HTTP status; rejects only on transport failure. */
  const send = async (request: {
    method: "POST" | "PUT";
    url: string;
    headers: Record<string, string>;
    data?: unknown;
    timeout: number;
    media?: boolean;
  }): Promise<Response> => {
    const authorization = await getAuthorization();
    // A token refresh may have consumed budget; bound the request by what is left.
    const left = remaining();
    if (left <= 0) throw ambiguous("youtube_upload_deadline");
    if (request.media) transmitted = true;
    const response = await axios.request<unknown>({
      method: request.method,
      url: request.url,
      headers: { ...request.headers, Authorization: authorization },
      data: request.data,
      timeout: Math.min(request.timeout, left),
      maxRedirects: 0,
      maxBodyLength: Number.POSITIVE_INFINITY,
      maxContentLength: RESPONSE_LIMIT_BYTES,
      // Every status is classified here, so axios never raises an error carrying the headers or body.
      validateStatus: () => true,
      responseType: "json",
    });
    return { status: response.status, headers: response.headers as Record<string, unknown>, data: response.data };
  };

  /** A definitive non-200 init answer: no session and no media, so no video can exist. */
  const rejection = (response: Response): PostError => {
    const reasons = knownReasons(response.data);
    const details = { httpStatus: response.status, reasons };
    if (response.status === 401)
      return fail(PostErrorType.CREDENTIALS_ERROR, CREDENTIALS, { code: "youtube_credentials_revoked", ...details });
    if (reasons.includes("uploadLimitExceeded"))
      return fail(PostErrorType.RATE_LIMIT_ERROR, UPLOAD_LIMIT, { code: "youtube_upload_limit", ...details });
    return fail(PostErrorType.PUBLISH_REJECTED, SAFE_TO_RETRY, { code: "youtube_init_rejected", ...details });
  };

  const accepted = (response: Response): YouTubeUploadResult => {
    const body = response.data as { id?: unknown; status?: { uploadStatus?: unknown } } | null | undefined;
    const id = body?.id;
    if (typeof id !== "string" || !/^[\w-]{1,64}$/.test(id))
      throw ambiguous("youtube_video_id_missing", response.status);
    const status = body?.status?.uploadStatus;
    const uploadStatus = typeof status === "string" && /^[a-z]{1,32}$/i.test(status) ? status : undefined;
    log.info(`[YouTubeUpload] Upload accepted with video ID ${id}${uploadStatus ? ` (${uploadStatus})` : ""}`);
    return { videoId: id, uploadStatus };
  };

  // Init: metadata only. Only a 200 carries a session URI; redirects are never followed.
  let session: string;
  try {
    const response = await send({
      method: "POST",
      url: INIT_URL,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": "application/octet-stream",
      },
      data: JSON.stringify(metadata),
      timeout: CONTROL_TIMEOUT_MS,
    });
    if (response.status !== 200) throw rejection(response);
    const location = header(response, "location");
    if (!isTrustedSessionUrl(location))
      throw fail(PostErrorType.API_ERROR, UNTRUSTED_SESSION, { code: "youtube_session_url_untrusted" });
    session = location;
  } catch (error) {
    if (error instanceof PostError) throw error;
    // Credential or transport failure before any session or media: no video can exist.
    throw isRevoked(error)
      ? fail(PostErrorType.CREDENTIALS_ERROR, CREDENTIALS, { code: "youtube_credentials_revoked" })
      : fail(PostErrorType.PUBLISH_REJECTED, SAFE_TO_RETRY, { code: "youtube_init_unreachable" });
  }
  log.info(`[YouTubeUpload] Resumable session created for ${size} bytes`);

  /** Stream the unacknowledged tail. The file is opened first so an unreadable file never hangs a request. */
  const put = async (start: number): Promise<Response> => {
    const stream = fs.createReadStream(filePath, { start });
    // Axios rejects the request on a read error; this only keeps one from becoming an unhandled event.
    stream.on("error", () => {});
    try {
      await once(stream, "open");
    } catch {
      stream.destroy();
      throw transmitted
        ? ambiguous("youtube_file_unreadable")
        : fail(PostErrorType.PREPARATION_ERROR, UNREADABLE_FILE, { code: "youtube_file_unreadable" });
    }
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(size - start),
      };
      if (start > 0) headers["Content-Range"] = `bytes ${start}-${size - 1}/${size}`;
      const timeout = putTimeoutMs(size - start);
      return await send({ method: "PUT", url: session, headers, data: stream, timeout, media: true });
    } finally {
      stream.destroy();
    }
  };

  // Transfer loop over one session: upload, or probe how much the session stored and resume from there.
  let acknowledged = 0;
  let recoveries = 0;
  let retryAfterMs = 0;
  stage = "upload";
  for (;;) {
    const probing: boolean = stage === "recover";
    if (probing && recoveries >= RECOVERY_DELAYS_MS.length) throw ambiguous("youtube_retry_budget");
    // Provider hints are honored on every path and never shorten the local backoff.
    const backoff = Math.max(probing ? RECOVERY_DELAYS_MS[recoveries] : 0, retryAfterMs);
    if (backoff > remaining()) throw ambiguous("youtube_upload_deadline");
    if (backoff > 0) await delay(backoff);
    retryAfterMs = 0;

    let response: Response;
    try {
      if (probing) {
        recoveries += 1;
        log.warn(`[YouTubeUpload] Recovering upload session (attempt ${recoveries}) after ${backoff}ms`);
        const headers = { "Content-Length": "0", "Content-Range": `bytes */${size}` };
        response = await send({ method: "PUT", url: session, headers, timeout: CONTROL_TIMEOUT_MS });
      } else {
        response = await put(acknowledged);
      }
    } catch (error) {
      if (error instanceof PostError) throw error;
      if (isRevoked(error))
        throw transmitted
          ? ambiguous("youtube_authorization_unavailable")
          : fail(PostErrorType.CREDENTIALS_ERROR, CREDENTIALS, { code: "youtube_credentials_revoked" });
      // Timeout or connection failure, on the upload or on a probe: bytes may be stored or even
      // finalized. Never assume either; ask the same session within the recovery budget.
      stage = "recover";
      continue;
    }

    retryAfterMs = parseRetryAfterMs(header(response, "retry-after"), Date.now()) ?? 0;
    if (response.status === 200 || response.status === 201) return accepted(response);
    if (response.status === 308) {
      const next = parseAcknowledgedBytes(header(response, "range"), size, acknowledged);
      if (next === undefined) throw ambiguous("youtube_range_invalid", 308);
      // Everything stored but not finalized: only a probe can return the final answer. An upload
      // that stored nothing new is retried only through bounded recovery, never hammered.
      stage = next === size || (!probing && next === acknowledged) ? "recover" : "upload";
      acknowledged = next;
      log.info(`[YouTubeUpload] Session acknowledged ${next}/${size} bytes`);
      continue;
    }
    if (TRANSIENT_STATUSES.has(response.status)) {
      stage = "recover";
      continue;
    }
    // Any other definitive answer while bytes were in flight (expired session, redirect, 4xx)
    // cannot prove that nothing was created. Surface it without retrying or re-initializing.
    throw ambiguous(probing ? "youtube_session_lost" : "youtube_upload_rejected", response.status);
  }
}
