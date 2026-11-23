/** Only return to workspace views; never accept an external or arbitrary redirect. */
export function recoveryReturnPath(value: string | null | undefined): string | null {
  if (!value || value.includes("\\") || /[\r\n]/.test(value)) return null;
  const path = value.split("?")[0];
  return path === "/" || path === "/accounts" || path === "/schedule" || /^\/posts\/[^/?#]+\/edit$/.test(path)
    ? value
    : null;
}

export function reconnectHref(accountId: string, returnTo: string): string {
  const params = new URLSearchParams({ reconnect: accountId, returnTo: recoveryReturnPath(returnTo) ?? "/accounts" });
  return `/accounts?${params}`;
}

export function resumeRecoveryHref(returnTo: string): string {
  const path = recoveryReturnPath(returnTo) ?? "/accounts";
  if (path !== "/schedule" && !/^\/posts\/[^/]+\/edit$/.test(path)) return path;
  return `${path}?resumeDraft=1`;
}
