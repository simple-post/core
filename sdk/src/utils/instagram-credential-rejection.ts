import type { CredentialRejection } from "../types/validation";

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Recognize permanent revocation, not ordinary expiry, missing scopes, rate limits, or outages. */
export function getInstagramCredentialRejection(value: unknown): CredentialRejection | undefined {
  const source = object(value);
  const response = object(source?.response);
  const body = object(response?.data) ?? object(source?.details) ?? source;
  const error = object(body?.error) ?? body;
  const status = response?.status;
  if (typeof status === "number" && status !== 400 && status !== 401) return undefined;
  if (error?.code !== 190 || error.is_transient === true) return undefined;
  const subcode = typeof error.error_subcode === "number" ? error.error_subcode : undefined;
  // An expired token can be handled by the existing refresh path. It is not evidence of revocation.
  if (subcode === 463) return undefined;
  const message = typeof error.message === "string" ? error.message.slice(0, 4000) : "";
  let reason: CredentialRejection["reason"] | undefined;
  if (subcode === 460 || /session has been invalidated/i.test(message)) reason = "session_revoked";
  else if (subcode === 458 || /user has not authorized (?:the )?application/i.test(message))
    reason = "authorization_removed";
  if (!reason) return undefined;
  return {
    reason,
    code: 190,
    ...(typeof status === "number" && { status }),
    ...(typeof subcode === "number" && Number.isSafeInteger(subcode) && { subcode }),
    ...(typeof error.fbtrace_id === "string" &&
      /^[\w-]{1,200}$/.test(error.fbtrace_id) && { traceId: error.fbtrace_id }),
  };
}
