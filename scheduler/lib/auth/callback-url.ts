/** Keep OAuth continuation queries intact without allowing an external login redirect. */
export function loginCallbackUrl(callback: string, appUrl: string): string {
  const base = new URL(appUrl);
  const url = new URL(callback, base.origin);
  if (!["https:", "http:"].includes(base.protocol) || url.origin !== base.origin || url.username || url.password) {
    throw new Error("The sign-in return URL must belong to SimplePost.");
  }
  // Better Auth applies a restrictive character check to relative callbacks.
  // Absolute same-origin URLs preserve nested URLs, scope colons and PKCE/state.
  return url.href;
}
