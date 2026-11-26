import type { Feature } from "@prisma/client";

export const PILOT_CONNECTION_FEATURES: readonly Feature[] = ["POST_ANALYTICS", "SOCIAL_INBOX", "TEAM_WORKSPACES"];

/** Only return to workspace views; never accept an external or arbitrary redirect. */
export function recoveryReturnPath(value: string | null | undefined): string | null {
  if (!value || value.includes("\\") || /[\r\n]/.test(value)) return null;
  const path = value.split("?")[0];
  return path === "/" ||
    path === "/accounts" ||
    path === "/analytics" ||
    path === "/inbox" ||
    path === "/schedule" ||
    /^\/posts\/[^/?#]+\/edit$/.test(path)
    ? value
    : null;
}

export function reconnectHref(accountId: string, returnTo: string, workspaceId?: string): string {
  const params = new URLSearchParams({ reconnect: accountId, returnTo: recoveryReturnPath(returnTo) ?? "/accounts" });
  if (workspaceId) params.set("workspace", workspaceId);
  return `/accounts?${params}`;
}

export function resumeRecoveryHref(returnTo: string): string {
  const path = recoveryReturnPath(returnTo) ?? "/accounts";
  if (path !== "/schedule" && !/^\/posts\/[^/]+\/edit$/.test(path)) return path;
  return `${path}?resumeDraft=1`;
}
