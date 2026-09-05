/** Retain actionable Meta diagnostics without request headers, tokens, or raw bodies. */
export async function readMetaError(response: Response) {
  try {
    const body = await response.json();
    const error = body?.error ?? body;
    if (!error || typeof error !== "object") return undefined;
    return {
      message:
        typeof error.message === "string"
          ? error.message
          : typeof error.error_message === "string"
            ? error.error_message
            : undefined,
      type:
        typeof error.type === "string"
          ? error.type
          : typeof error.error_type === "string"
            ? error.error_type
            : undefined,
      code:
        typeof error.code === "number"
          ? error.code
          : typeof error.error_code === "number"
            ? error.error_code
            : undefined,
      subcode: typeof error.error_subcode === "number" ? error.error_subcode : undefined,
      traceId: typeof error.fbtrace_id === "string" ? error.fbtrace_id : undefined,
    };
  } catch {
    return undefined;
  }
}
