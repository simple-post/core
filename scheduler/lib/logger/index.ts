import pino, { type Logger } from "pino";

const isDevelopment = process.env.NODE_ENV !== "production";

/**
 * Base Pino logger instance with structured logging configuration
 * - In development: Pretty-printed output for readability
 * - In production: JSON output for log aggregation systems
 */
const baseLogger = pino({
  level: process.env.LOG_LEVEL || (isDevelopment ? "debug" : "info"),
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
  if (error instanceof Error) {
    const result: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    if (error.cause) {
      result.cause = serializeError(error.cause);
    }
    return result;
  }
  return { message: String(error) };
}

/**
 * Utility to redact sensitive data from objects before logging
 * @param obj - The object to redact
 * @param keys - Keys to redact (defaults to common sensitive keys)
 * @returns Object with sensitive values replaced
 */
export function redact<T extends Record<string, unknown>>(
  obj: T,
  keys: string[] = ["accessToken", "refreshToken", "password", "secret", "apiKey", "credentials"],
): T {
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
