import pino, { type Logger } from "pino";

import { SENSITIVE_KEYS } from "@/lib/logger/sensitive-keys";
import { isTelegramNotificationEnabled, sendTelegramLogNotification } from "@/lib/logger/telegram";

const isDevelopment = process.env.NODE_ENV !== "production";
const ERROR_LEVEL = pino.levels.values.error;
const MAX_CAUSE_DEPTH = 5;
const LEVEL_LABELS = new Map(Object.entries(pino.levels.values).map(([label, value]) => [value, label]));

const REDACT_PATHS = [
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((key) => `*.${key}`),
  ...SENSITIVE_KEYS.map((key) => `req.headers.${key}`),
  "req.headers.authorization",
  "req.headers.cookie",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type LogLevelLabel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

function levelLabel(level: number): LogLevelLabel {
  return (LEVEL_LABELS.get(level) || "error") as LogLevelLabel;
}

function queueTelegramNotification(
  label: LogLevelLabel,
  message: string,
  context: Record<string, unknown>,
  error?: unknown,
): void {
  void sendTelegramLogNotification({
    level: label,
    message,
    timestamp: new Date().toISOString(),
    context: redact(context),
    error: error ? redact({ error }).error : undefined,
  });
}

function extractLogMessage(inputArgs: unknown[]): string {
  const stringArg = inputArgs.find((arg): arg is string => typeof arg === "string");
  if (stringArg) return stringArg;

  const first = inputArgs[0];
  if (first instanceof Error) return first.message;
  if (isPlainObject(first) && typeof first.message === "string") return first.message;

  return "Application error";
}

function extractLogContext(inputArgs: unknown[], bindings: Record<string, unknown>): Record<string, unknown> {
  const [first] = inputArgs;
  if (isPlainObject(first) && !(first instanceof Error)) {
    return { ...bindings, ...first };
  }
  return { ...bindings };
}

function extractLogError(inputArgs: unknown[], context: Record<string, unknown>): unknown {
  const [first] = inputArgs;
  if (first instanceof Error) return serializeError(first);
  const candidate = context.err || context.error;
  return candidate instanceof Error ? serializeError(candidate) : candidate;
}

/**
 * Base Pino logger instance with structured logging configuration
 * - In development: Pretty-printed output for readability
 * - In production: JSON output for log aggregation systems
 */
const baseLogger = pino({
  level: process.env.LOG_LEVEL || (isDevelopment ? "debug" : "info"),
  base: {
    service: "simplepost-scheduler",
    env: process.env.NODE_ENV || "development",
  },
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  hooks: {
    logMethod(inputArgs, method, level) {
      // Fan error/fatal logs out to Telegram, but only do the (non-trivial)
      // context extraction + redaction work when Telegram is actually enabled
      // for this level — otherwise it runs on every error log for nothing.
      if (level >= ERROR_LEVEL) {
        const label = levelLabel(level);
        if (isTelegramNotificationEnabled(label)) {
          const logger = this as Logger;
          const bindings = typeof logger.bindings === "function" ? logger.bindings() : {};
          const context = extractLogContext(inputArgs, bindings);
          queueTelegramNotification(label, extractLogMessage(inputArgs), context, extractLogError(inputArgs, context));
        }
      }

      (method as (...args: unknown[]) => void).apply(this, inputArgs);
    },
  },
  ...(isDevelopment
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }
    : {
        // Production: JSON format for log aggregation
        formatters: {
          level: (label) => ({ level: label }),
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
});

/**
 * Create a child logger with a specific context (module name)
 * @param module - The module name for context (e.g., "api:posts", "posting", "media")
 * @returns A child logger with the module context
 */
export function createLogger(module: string): Logger {
  return baseLogger.child({ module });
}

/**
 * Create a request-scoped logger with request context
 * @param module - The module name
 * @param requestId - Optional request ID for tracing
 * @returns A child logger with request context
 */
export function createRequestLogger(module: string, requestId?: string): Logger {
  return baseLogger.child({
    module,
    ...(requestId && { requestId }),
  });
}

/**
 * Utility to safely serialize errors for logging
 * @param error - The error to serialize
 * @returns Serialized error object
 */
export function serializeError(error: unknown): Record<string, unknown> {
  return serializeErrorInternal(error, new WeakSet<object>(), 0);
}

function serializeErrorInternal(error: unknown, seen: WeakSet<object>, depth: number): Record<string, unknown> {
  if (error instanceof Error) {
    if (seen.has(error)) {
      return { name: error.name, message: error.message, cause: "[Circular]" };
    }
    seen.add(error);

    const result: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    for (const key of ["code", "status", "statusCode", "digest"] as const) {
      if (key in error) {
        result[key] = (error as Error & Record<typeof key, unknown>)[key];
      }
    }
    if (error.cause) {
      result.cause =
        depth >= MAX_CAUSE_DEPTH ? "[cause chain truncated]" : serializeErrorInternal(error.cause, seen, depth + 1);
    }
    return result;
  }
  if (isPlainObject(error)) {
    return redact(error);
  }
  return { message: String(error) };
}

/**
 * Utility to redact sensitive data from objects before logging
 * @param obj - The object to redact
 * @param keys - Keys to redact (defaults to common sensitive keys)
 * @returns Object with sensitive values replaced
 */
export function redact<T extends Record<string, unknown>>(obj: T, keys: readonly string[] = SENSITIVE_KEYS): T {
  const sensitiveKeys = new Set(keys.map((key) => key.toLowerCase()));

  function redactValue(value: unknown, seen: WeakSet<object>): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, seen));
    }
    if (!isPlainObject(value)) {
      return value;
    }
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = sensitiveKeys.has(key.toLowerCase()) ? "[REDACTED]" : redactValue(item, seen);
    }
    seen.delete(value);
    return result;
  }

  return redactValue(obj, new WeakSet<object>()) as T;
}

/**
 * @deprecated Kept for compatibility with older imports. Use redact instead.
 */
export function redactObject<T extends Record<string, unknown>>(obj: T, keys: readonly string[] = SENSITIVE_KEYS): T {
  const redacted = { ...obj };
  for (const key of Object.keys(redacted)) {
    if (keys.includes(key)) {
      (redacted as Record<string, unknown>)[key] = "[REDACTED]";
    } else if (typeof redacted[key] === "object" && redacted[key] !== null) {
      (redacted as Record<string, unknown>)[key] = redact(redacted[key] as Record<string, unknown>, keys);
    }
  }
  return redacted;
}

// Export pre-configured loggers for common modules
export const logger = baseLogger;
export const apiLogger = createLogger("api");
export const postingLogger = createLogger("posting");
export const mediaLogger = createLogger("media");
export const authLogger = createLogger("auth");
export const dbLogger = createLogger("db");
