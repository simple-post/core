/** Inspect status only, never auth request bodies, emails, OTPs or returned tokens. */
export function authObservation(
  path: string | undefined,
  returned: unknown,
): { kind: "authentication_failed"; method: string; reason: string } | null {
  if (!path || !["/sign-in/email-otp", "/sign-in/social"].includes(path)) return null;
  const status =
    returned instanceof Response
      ? returned.status
      : returned && typeof returned === "object" && "statusCode" in returned
        ? Number(returned.statusCode)
        : 200;
  if (!Number.isFinite(status) || status < 400) return null;
  return {
    kind: "authentication_failed",
    method: path.includes("email-otp") ? "email" : "google",
    reason: status === 429 ? "rate_limited" : status >= 500 ? "service_failed" : "verification_failed",
  };
}
