import { type NextRequest, NextResponse } from "next/server";

import { ZodError } from "zod";

import { apiLogger, serializeError } from "@/lib/logger";
import { isSensitiveKey } from "@/lib/logger/sensitive-keys";

/**
 * Recursively sanitizes an object for JSON/Prisma storage by removing
 * non-serializable values (functions, streams, circular refs, etc.)
 */
export function sanitizeForJson<T>(value: T): unknown {
  const ancestors = new WeakSet<object>();
  const skipKeys = new Set([
    "config",
    "request",
    "headers",
    "paramsSerializer",
    "validateStatus",
    "transformRequest",
    "transformResponse",
    "adapter",
    "errorRedactor",
  ]);
  const visit = (item: unknown, depth: number): unknown => {
    if (item === null || item === undefined) return item;
    if (typeof item === "function" || typeof item === "symbol") return undefined;
    if (typeof item === "number") return Number.isFinite(item) ? item : null;
    if (typeof item === "bigint") return item.toString();
    if (typeof item === "string") {
      return item
        .replaceAll(/Bearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]")
        .replaceAll(/([?&](?:access_token|refresh_token|client_secret|api_key|token)=)[^&\s"'<>]*/gi, "$1[REDACTED]")
        .replaceAll(/(api\.telegram\.org\/bot)[^/\s]+/gi, "$1[REDACTED]");
    }
    if (typeof item !== "object") return item;
    if (item instanceof Date) return item.toJSON();
    if (depth > 12) return "[Truncated]";
    if (ancestors.has(item)) return "[Circular]";
    if ("pipe" in item) return undefined;
    ancestors.add(item);
    try {
      if (Array.isArray(item)) return item.map((entry) => visit(entry, depth + 1));
      const obj = item as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      // Never invoke provider toJSON methods: Axios includes credentials in config.
      if (item instanceof Error) {
        result.name = item.name;
        result.message = visit(item.message, depth + 1);
        result.stack = visit(item.stack, depth + 1);
        if (item.cause) result.cause = visit(item.cause, depth + 1);
      }
      for (const [key, entry] of Object.entries(obj)) {
        if (skipKeys.has(key)) continue;
        const sanitized = isSensitiveKey(key) ? "[REDACTED]" : visit(entry, depth + 1);
        if (sanitized !== undefined) result[key] = sanitized;
      }
      return result;
    } finally {
      ancestors.delete(item);
    }
  };
  return visit(value, 0);
}

/**
 * Base error class for API errors
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string,
    /** Structured diagnostics written to server logs but never returned to API clients. */
    public logContext?: Record<string, unknown>,
  ) {
    super(message);
    // Constructor names are minified in production bundles. Subclasses assign
    // a stable public name so logs and alerts never degrade to values like `i`.
    this.name = "ApiError";
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Unauthorized error (401)
 */
export class UnauthorizedError extends ApiError {
  constructor(message: string = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

/**
 * Payment required error (402)
 */
export class PaymentRequiredError extends ApiError {
  constructor(message: string = "An active subscription is required", logContext?: Record<string, unknown>) {
    super(message, 402, "PAYMENT_REQUIRED", logContext);
    this.name = "PaymentRequiredError";
  }
}

/**
 * Forbidden error (403)
 */
export class ForbiddenError extends ApiError {
  constructor(message: string = "Forbidden", logContext?: Record<string, unknown>) {
    super(message, 403, "FORBIDDEN", logContext);
    this.name = "ForbiddenError";
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends ApiError {
  constructor(message: string = "Resource not found") {
    super(message, 404, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

/**
 * Bad request error (400)
 */
export class BadRequestError extends ApiError {
  constructor(message: string = "Bad request") {
    super(message, 400, "BAD_REQUEST");
    this.name = "BadRequestError";
  }
}

/**
 * Validation error (400) with structured details
 */
export class ValidationError extends ApiError {
  constructor(
    public details: unknown,
    message: string = "Validation failed",
  ) {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends ApiError {
  constructor(message: string = "Resource conflict") {
    super(message, 409, "CONFLICT");
    this.name = "ConflictError";
  }
}

/**
 * Gone error (410)
 */
export class GoneError extends ApiError {
  constructor(message: string = "Resource is no longer available") {
    super(message, 410, "GONE");
    this.name = "GoneError";
  }
}

/**
 * Internal server error (500)
 */
export class InternalServerError extends ApiError {
  constructor(message: string = "Internal server error") {
    super(message, 500, "INTERNAL_SERVER_ERROR");
    this.name = "InternalServerError";
  }
}

function formatZodErrorMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return "Invalid request";
  }

  const path = issue.path.length > 0 ? issue.path.join(".") : "";
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * Builds the structured log payload for an ApiError, surfacing its private
 * logContext as top-level fields for log querying.
 */
export function apiErrorLogPayload(error: ApiError): Record<string, unknown> {
  return {
    err: serializeError(error),
    // Keep the canonical nested error while also exposing the two fields that
    // alerting systems can reliably interpolate without nested-object access.
    error: error.name,
    errorMessage: error.message,
    statusCode: error.statusCode,
    code: error.code,
    ...error.logContext,
  };
}

/**
 * Handles errors and returns appropriate NextResponse
 */
export function handleApiError(error: unknown): NextResponse {
  // Log error with structured logging
  if (error instanceof ApiError) {
    const payload = apiErrorLogPayload(error);
    if (error.statusCode >= 500) {
      apiLogger.error(payload, "API error occurred");
    } else {
      apiLogger.warn(payload, "API request rejected");
    }
  } else if (error instanceof ZodError) {
    apiLogger.warn({ err: serializeError(error), statusCode: 400, code: "VALIDATION_ERROR" }, "API request rejected");
  } else {
    apiLogger.error({ err: serializeError(error) }, "Unexpected API error");
  }

  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error instanceof ValidationError && { details: error.details }),
      },
      { status: error.statusCode },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: formatZodErrorMessage(error),
        code: "VALIDATION_ERROR",
        details: error.issues,
      },
      { status: 400 },
    );
  }

  // Handle unknown errors
  const message = error instanceof Error ? error.message : "An unexpected error occurred";
  return NextResponse.json(
    {
      error: message,
      code: "INTERNAL_SERVER_ERROR",
    },
    { status: 500 },
  );
}

/**
 * Wraps an API route handler with error handling
 */
export function withErrorHandling(handler: (req: NextRequest, context?: unknown) => Promise<NextResponse>) {
  return async (req: NextRequest, context?: unknown): Promise<NextResponse> => {
    try {
      return await handler(req, context);
    } catch (error) {
      return handleApiError(error);
    }
  };
}
