/** Keep the actionable validation reasons already returned by the API. */
export class ApiResponseError extends Error {
  public readonly code?: string;
  public readonly reason?: string;
  constructor(
    data: unknown,
    fallback: string,
    public readonly status: number,
  ) {
    super(apiResponseError(data, fallback));
    this.name = "ApiResponseError";
    const body = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    this.code = typeof body.code === "string" ? body.code : undefined;
    this.reason = typeof body.reason === "string" ? body.reason : undefined;
  }
}

export function apiResponseError(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const body = data as { error?: unknown; details?: unknown };
  const messages: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || messages.length >= 5 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const object = value as Record<string, unknown>;
    if (typeof object.message === "string") messages.push(object.message);
    else
      for (const [key, child] of Object.entries(object)) {
        if (key !== "warnings") visit(child, depth + 1);
      }
  };
  const details = body.details as { imageFitHelp?: unknown; summary?: { errors?: unknown } } | undefined;
  const summary = details?.summary;
  visit(summary?.errors ?? body.details, 0);
  if (typeof details?.imageFitHelp === "string") messages.push(details.imageFitHelp);
  return messages.length > 0
    ? [...new Set(messages)].join(" ")
    : typeof body.error === "string"
      ? body.error
      : fallback;
}

/** Never infer UI behavior from translated or provider-authored error prose. */
export function isScheduledTimeError(error: unknown): boolean {
  return error instanceof ApiResponseError && error.reason === "INVALID_SCHEDULED_TIME";
}
export function isTrialSubmissionError(error: unknown): boolean {
  return error instanceof ApiResponseError && ["TRIAL_ALLOWANCE", "TRIAL_EXPIRED"].includes(error.reason ?? "");
}
