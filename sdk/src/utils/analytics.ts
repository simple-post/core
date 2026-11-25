import { createHash } from "node:crypto";

import { httpStatus } from "./transient-retry";

import { PostError, PostErrorType } from "../types";

import type { AnalyticsStatus, PostAnalytics, PostMetrics } from "../analytics";
import type { Platform } from "../types/post";

/** Thrown by analytics providers to report a specific, user-facing status. */
export class AnalyticsError extends Error {
  readonly status: AnalyticsStatus;

  constructor(status: AnalyticsStatus, message: string) {
    super(message);
    this.name = "AnalyticsError";
    this.status = status;
  }
}

const META_PERMISSION_CODES = new Set([10, 200, 210, 220, 230, 270, 294]);
const META_RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80_001, 80_002, 80_004, 80_005, 80_006, 80_008]);
const META_CREDENTIAL_CODES = new Set([102, 190, 463, 467]);

function providerErrorBody(error: unknown): Record<string, unknown> | undefined {
  const data =
    (error as { response?: { data?: unknown } } | undefined)?.response?.data ??
    (error as { data?: unknown } | undefined)?.data;
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
}

/**
 * Extracts a short provider message. Only well-known message fields are read so
 * request URLs/headers (which may contain tokens) never leak into results.
 */
export function providerErrorMessage(error: unknown): string | undefined {
  const body = providerErrorBody(error);
  const nested = body?.error;
  const candidates: unknown[] = [
    nested && typeof nested === "object" ? (nested as Record<string, unknown>).message : nested,
    body?.detail,
    body?.message,
    body?.error_description,
    body?.title,
    (body?.errors as Array<{ message?: unknown }> | undefined)?.[0]?.message,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 300);
  }
  return undefined;
}

function metaErrorCode(error: unknown): number | undefined {
  const nested = providerErrorBody(error)?.error;
  const code = nested && typeof nested === "object" ? (nested as { code?: unknown }).code : undefined;
  return typeof code === "number" ? code : undefined;
}

/** Maps any thrown provider/network error onto an analytics status and a safe message. */
export function classifyAnalyticsError(
  error: unknown,
  platformLabel: string,
): { status: AnalyticsStatus; message: string } {
  if (error instanceof AnalyticsError) return { status: error.status, message: error.message };
  if (error instanceof PostError) {
    if (error.errorType === PostErrorType.CREDENTIALS_ERROR)
      return { status: "credentials_error", message: error.message };
    if (error.errorType === PostErrorType.RATE_LIMIT_ERROR) return { status: "rate_limited", message: error.message };
    return { status: "error", message: error.message };
  }

  const status = httpStatus(error);
  const code = metaErrorCode(error);
  const detail = providerErrorMessage(error);
  const suffix = detail ? `: ${detail}` : ".";

  if (code !== undefined && META_CREDENTIAL_CODES.has(code)) {
    return { status: "credentials_error", message: `${platformLabel} rejected the saved credentials${suffix}` };
  }
  if (code !== undefined && META_PERMISSION_CODES.has(code)) {
    return {
      status: "missing_permission",
      message: `${platformLabel} did not grant permission to read analytics${suffix} Reconnect the account to approve the analytics permission.`,
    };
  }
  if (code !== undefined && META_RATE_LIMIT_CODES.has(code)) {
    return { status: "rate_limited", message: `${platformLabel} rate limit reached${suffix}` };
  }
  if (status === 401) {
    return { status: "credentials_error", message: `${platformLabel} rejected the saved credentials${suffix}` };
  }
  if (status === 403) {
    return {
      status: "missing_permission",
      message: `${platformLabel} did not allow reading analytics${suffix} Reconnect the account to approve the analytics permission.`,
    };
  }
  if (status === 404) return { status: "not_found", message: `${platformLabel} could not find this post${suffix}` };
  if (status === 429) return { status: "rate_limited", message: `${platformLabel} rate limit reached${suffix}` };

  const fallback = error instanceof Error && error.message ? error.message.slice(0, 300) : "Unknown error";
  return { status: "error", message: `${platformLabel} analytics request failed: ${detail ?? fallback}` };
}

export function postAnalyticsResult(
  platform: Platform,
  postId: string,
  status: AnalyticsStatus,
  fields: Partial<Omit<PostAnalytics, "platform" | "postId" | "status" | "fetchedAt">> = {},
): PostAnalytics {
  return {
    platform,
    postId,
    status,
    metrics: fields.metrics ?? {},
    ...(fields.platformMetrics && Object.keys(fields.platformMetrics).length > 0
      ? { platformMetrics: fields.platformMetrics }
      : {}),
    ...(fields.url ? { url: fields.url } : {}),
    ...(fields.publishedAt ? { publishedAt: fields.publishedAt } : {}),
    ...(fields.resolvedPostId ? { resolvedPostId: fields.resolvedPostId } : {}),
    ...(fields.message ? { message: fields.message } : {}),
    fetchedAt: new Date().toISOString(),
  };
}

/** Copies finite numbers from a provider object into a metrics record using a name map. */
export function pickMetrics(
  source: Record<string, unknown> | undefined,
  mapping: Record<string, keyof PostMetrics>,
): PostMetrics {
  const metrics: PostMetrics = {};
  if (!source) return metrics;
  for (const [nativeName, metric] of Object.entries(mapping)) {
    const value = toFiniteNumber(source[nativeName]);
    if (value !== undefined) metrics[metric] = (metrics[metric] ?? 0) + value;
  }
  return metrics;
}

/** Collects every finite numeric field of a provider object (for `platformMetrics`). */
export function numericFields(source: Record<string, unknown> | undefined, prefix = ""): Record<string, number> {
  const result: Record<string, number> = {};
  if (!source) return result;
  for (const [key, value] of Object.entries(source)) {
    const number = toFiniteNumber(value);
    if (number !== undefined) result[`${prefix}${key}`] = number;
  }
  return result;
}

export function toFiniteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  const step = Math.max(1, size);
  for (let index = 0; index < items.length; index += step) chunks.push(items.slice(index, index + step));
  return chunks;
}

/** Runs async work with a small concurrency limit, preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Short, non-reversible key identifying a credential (for per-credential in-memory caches). */
export function credentialKey(...parts: Array<string | undefined>): string {
  return createHash("sha256").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 24);
}
