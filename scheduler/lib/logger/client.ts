"use client";

import { isSensitiveKey } from "@/lib/logger/sensitive-keys";

type ClientLogLevel = "error" | "warn";

interface ClientErrorPayload {
  level: ClientLogLevel;
  message: string;
  error?: Record<string, unknown>;
  context?: Record<string, unknown>;
  url?: string;
  userAgent?: string;
  timestamp: string;
}

const MAX_STRING_LENGTH = 2000;
const MAX_BODY_LENGTH = 16_000;
const DEDUPE_WINDOW_MS = 5000;

// Suppress duplicate reports for the same error within a short window. The same
// failure often surfaces twice (e.g. the React error boundary and the global
// window "error" listener both fire), and we don't want to double-log or double
// the Telegram notifications it triggers server-side.
const recentlySent = new Map<string, number>();

function truncate(value: string, maxLength = MAX_STRING_LENGTH): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 14)}... [truncated]`;
}

function sanitizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "function" || typeof value === "symbol") return String(value);

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      result[key] = isSensitiveKey(key) ? "[REDACTED]" : sanitizeValue(item, seen);
    }

    seen.delete(value);
    return result;
  }

  return String(value);
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };

    if ("digest" in error) {
      serialized.digest = (error as Error & { digest?: string }).digest;
    }

    return serialized;
  }

  const sanitized = sanitizeValue(error);
  const serializedValue = JSON.stringify(sanitized);

  return {
    message: typeof error === "string" ? error : truncate(serializedValue || String(error)),
    value: sanitized,
  };
}

function isDuplicate(payload: ClientErrorPayload): boolean {
  const error = payload.error;
  const name = typeof error?.name === "string" ? error.name : "";
  const message = typeof error?.message === "string" ? error.message : "";
  const stackFrame = typeof error?.stack === "string" ? (error.stack.split("\n")[1] ?? "").trim() : "";
  const signature = `${payload.level}|${name}|${message || payload.message}|${stackFrame}`;

  const now = Date.now();
  // Opportunistically prune stale entries so the map cannot grow unbounded.
  if (recentlySent.size > 100) {
    for (const [key, sentAt] of recentlySent) {
      if (now - sentAt > DEDUPE_WINDOW_MS) recentlySent.delete(key);
    }
  }

  const lastSentAt = recentlySent.get(signature);
  if (lastSentAt !== undefined && now - lastSentAt < DEDUPE_WINDOW_MS) {
    return true;
  }

  recentlySent.set(signature, now);
  return false;
}

function postClientLog(payload: ClientErrorPayload): void {
  if (isDuplicate(payload)) return;

  try {
    let body = JSON.stringify(payload);
    if (body.length > MAX_BODY_LENGTH) {
      body = JSON.stringify({
        ...payload,
        context: { truncated: true },
        error: payload.error
          ? {
              name: payload.error.name,
              message: payload.error.message,
              digest: payload.error.digest,
            }
          : undefined,
      });
    }

    void fetch("/api/internal/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: body.length <= MAX_BODY_LENGTH,
    }).catch((error) => {
      console.warn("Failed to report client error:", error);
    });
  } catch (error) {
    console.warn("Failed to serialize client error:", error);
  }
}

function getClientUrl(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.href;
}

function getUserAgent(): string | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.userAgent;
}

export function logClientError(
  error: unknown,
  message: string = "Client error",
  context?: Record<string, unknown>,
): void {
  console.error(message, error, context || "");

  postClientLog({
    level: "error",
    message,
    error: serializeError(error),
    context: context ? (sanitizeValue(context) as Record<string, unknown>) : undefined,
    url: getClientUrl(),
    userAgent: getUserAgent(),
    timestamp: new Date().toISOString(),
  });
}

export function logClientWarning(message: string, context?: Record<string, unknown>): void {
  console.warn(message, context || "");

  postClientLog({
    level: "warn",
    message,
    context: context ? (sanitizeValue(context) as Record<string, unknown>) : undefined,
    url: getClientUrl(),
    userAgent: getUserAgent(),
    timestamp: new Date().toISOString(),
  });
}
