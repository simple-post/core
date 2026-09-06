// Diagnostics may contain provider errors. Remove known secret values before writing artifacts.
export function redact(text: string): string {
  let result = text.replace(/Bearer\s+[^\s"<>]+/gi, "Bearer [REDACTED]");
  for (const [key, value] of Object.entries(process.env))
    if (/TOKEN|PASSWORD|SECRET|API_KEY|ACCESS_KEY/i.test(key) && value && value.length >= 6)
      result = result.split(value).join("[REDACTED]");
  return result.replace(
    /((?:access_token|refresh_token|client_secret|api_key)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi,
    "$1[REDACTED]",
  );
}
