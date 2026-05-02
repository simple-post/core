import type { Response } from "express";

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class BadRequestError extends ApiError {
  constructor(message: string = "Bad request") {
    super(message, 400, "BAD_REQUEST");
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ValidationError extends ApiError {
  constructor(
    public details: unknown,
    message: string = "Validation failed"
  ) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class InternalServerError extends ApiError {
  constructor(message: string = "Internal server error") {
    super(message, 500, "INTERNAL_SERVER_ERROR");
  }
}

export function handleApiError(error: unknown, res: Response): void {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
      ...(error instanceof ValidationError && { details: error.details }),
    });
    return;
  }

  console.error("Unexpected API error:", error);
  const message = error instanceof Error ? error.message : "An unexpected error occurred";
  res.status(500).json({
    error: message,
    code: "INTERNAL_SERVER_ERROR",
  });
}

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
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForJson(item)).filter((item) => item !== undefined);
  }
  const obj = value as Record<string, unknown>;
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
    if (v && typeof v === "object" && "pipe" in v) continue;
    const sanitized = sanitizeForJson(v);
    if (sanitized !== undefined) result[k] = sanitized;
  }
  return result;
}
