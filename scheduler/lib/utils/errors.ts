import { type NextRequest, NextResponse } from "next/server";

import { apiLogger, serializeError } from "@/lib/logger";

/**
 * Recursively sanitizes an object for JSON/Prisma storage by removing
 * non-serializable values (functions, streams, circular refs, etc.)
 */
export function sanitizeForJson<T>(value: T): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (typeof value !== "object") {
    return value;
  }
  // Handle Error instances
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForJson(item)).filter((item) => item !== undefined);
  }
  // Handle plain objects - extract API error structure when present
  const obj = value as Record<string, unknown>;
  if (obj.response && typeof obj.response === "object") {
    const response = obj.response as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    if (response.data && typeof response.data === "object") {
      const data = response.data as Record<string, unknown>;
      if (data.error) result.error = sanitizeForJson(data.error);
    }
    if (response.status !== undefined) result.status = response.status;
    if (response.statusText) result.statusText = response.statusText;
    if (obj.code !== undefined) result.code = obj.code;
    if (obj.message) result.message = obj.message;
    return result;
  }
  // Generic object - filter out known problematic keys and non-serializable values
  const skipKeys = new Set([
    "paramsSerializer",
    "validateStatus",
    "transformRequest",
    "transformResponse",
    "adapter",
    "errorRedactor",
  ]);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (skipKeys.has(k)) continue;
    if (typeof v === "function" || typeof v === "symbol") continue;
    if (v && typeof v === "object" && "pipe" in v) continue; // Skip streams
    const sanitized = sanitizeForJson(v);
    if (sanitized !== undefined) result[k] = sanitized;
  }
  return result;
}

/**
 * Base error class for API errors
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Unauthorized error (401)
 */
export class UnauthorizedError extends ApiError {
  constructor(message: string = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}

/**
 * Payment required error (402)
 */
export class PaymentRequiredError extends ApiError {
  constructor(message: string = "An active subscription is required") {
    super(message, 402, "PAYMENT_REQUIRED");
  }
}

/**
 * Forbidden error (403)
 */
export class ForbiddenError extends ApiError {
  constructor(message: string = "Forbidden") {
    super(message, 403, "FORBIDDEN");
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends ApiError {
  constructor(message: string = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

/**
 * Bad request error (400)
 */
export class BadRequestError extends ApiError {
  constructor(message: string = "Bad request") {
    super(message, 400, "BAD_REQUEST");
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
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends ApiError {
  constructor(message: string = "Resource conflict") {
    super(message, 409, "CONFLICT");
  }
}

/**
 * Gone error (410)
 */
export class GoneError extends ApiError {
  constructor(message: string = "Resource is no longer available") {
    super(message, 410, "GONE");
  }
}

/**
 * Internal server error (500)
 */
export class InternalServerError extends ApiError {
  constructor(message: string = "Internal server error") {
    super(message, 500, "INTERNAL_SERVER_ERROR");
  }
}

/**
 * Handles errors and returns appropriate NextResponse
 */
export function handleApiError(error: unknown): NextResponse {
  // Log error with structured logging
  if (error instanceof ApiError) {
    const payload = { err: serializeError(error), statusCode: error.statusCode, code: error.code };
    if (error.statusCode >= 500) {
      apiLogger.error(payload, "API error occurred");
    } else {
      apiLogger.warn(payload, "API error occurred");
    }
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
