import type { ConnectedAccount } from "@/types";

const USERNAME_PLATFORMS = new Set(["x", "instagram", "tiktok"]);

export function getAccountDisplayName(account: ConnectedAccount) {
  if (USERNAME_PLATFORMS.has(account.platform) && account.username) {
    return `@${account.username}`;
  }

  return (
    account.displayName ||
    (account.username ? `@${account.username}` : null) ||
    account.email ||
    account.platformAccountId
  );
}
