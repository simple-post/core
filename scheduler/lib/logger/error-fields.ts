/** Bounded diagnostics for flat OTLP attributes; never copy request/config objects. */
export function diagnosticText(value: string): string {
  return value
    .replaceAll(/Bearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]")
    .replaceAll(/(https?:\/\/[^\s?"'<>]+)\?[^\s"'<>]*/gi, "$1?[REDACTED]")
    .replaceAll(
      /([?&](?:access_token|refresh_token|client_secret|api_key|token|code|state)=)[^&\s"'<>]*/gi,
      "$1[REDACTED]",
    )
    .replaceAll(/(api\.telegram\.org\/bot)[^/\s]+/gi, "$1[REDACTED]")
    .slice(0, 4000);
}

export function flatErrorFields(error: unknown): Record<string, string | number> {
  if (!error || typeof error !== "object") return {};
  const source = error as Record<string, unknown>;
  const fields: Record<string, string | number> = {};
  for (const [key, value] of Object.entries({
    errorType: source.name ?? source.type,
    errorMessage: source.message,
    errorCode: source.code,
    errorStack: source.stack,
  })) {
    if (typeof value === "string") fields[key] = diagnosticText(value);
    else if (typeof value === "number" && Number.isFinite(value)) fields[key] = value;
  }
  return fields;
}
