const BROWSER_EXTENSION_URL_PATTERN = /\b(?:chrome|moz|safari|ms-browser)-extension:\/\//i;

function getStringField(value: unknown, field: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === "string" ? candidate : undefined;
}

function getFirstStackFrame(stack: string): string | undefined {
  return stack
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^at(?:\s|$)/.test(line) || /@\S/.test(line));
}

/**
 * Returns true when an error originated in a browser extension rather than
 * the scheduler. Only the first stack frame is considered so an application
 * error is not discarded merely because an extension appears farther down
 * the call stack.
 */
export function isBrowserExtensionError(error?: unknown, context?: Record<string, unknown>): boolean {
  const source =
    (typeof context?.source === "string" && context.source) ||
    (typeof context?.filename === "string" && context.filename);
  if (source && BROWSER_EXTENSION_URL_PATTERN.test(source)) return true;

  const stack = error instanceof Error ? error.stack : getStringField(error, "stack");
  if (stack) {
    const firstFrame = getFirstStackFrame(stack);
    if (firstFrame) return BROWSER_EXTENSION_URL_PATTERN.test(firstFrame);

    // Some browsers provide a single-line stack without a conventional frame.
    if (BROWSER_EXTENSION_URL_PATTERN.test(stack)) return true;
  }

  const message =
    typeof error === "string" ? error : error instanceof Error ? error.message : getStringField(error, "message");
  return Boolean(message && BROWSER_EXTENSION_URL_PATTERN.test(message));
}
