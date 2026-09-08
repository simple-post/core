/** Keep the actionable validation reasons already returned by the API. */
export class ApiResponseError extends Error {
  constructor(
    data: unknown,
    fallback: string,
    public readonly status: number,
  ) {
    super(apiResponseError(data, fallback));
    this.name = "ApiResponseError";
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
    else for (const child of Object.values(object)) visit(child, depth + 1);
  };
  visit(body.details, 0);
  return messages.length > 0
    ? [...new Set(messages)].join(" ")
    : typeof body.error === "string"
      ? body.error
      : fallback;
}
