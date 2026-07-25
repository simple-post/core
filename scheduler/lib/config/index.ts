export type ConnectionType = "oauth" | "manual";

export interface SocialPlatform {
  id: string;
  name: string;
  description: string;
  color: string;
  connectionType: ConnectionType;
}

export const ALL_SOCIAL_PLATFORMS: SocialPlatform[] = [
  {
    id: "x",
    name: "X (Twitter)",
    description: "Post tweets and threads",
    color: "bg-black",
    connectionType: "oauth",
  },
  {
    id: "youtube",
    name: "YouTube",
    description: "Upload videos and shorts",
    color: "bg-red-600",
    connectionType: "oauth",
  },
  {
    id: "instagram",
    name: "Instagram",
    description: "Post photos and reels",
    color: "bg-gradient-to-r from-purple-600 to-pink-600",
    connectionType: "oauth",
  },
  {
    id: "facebook",
    name: "Facebook",
    description: "Publish posts and updates",
    color: "bg-blue-600",
    connectionType: "oauth",
  },
  {
    id: "tiktok",
    name: "TikTok",
    description: "Share videos",
    color: "bg-black",
    connectionType: "oauth",
  },
  {
    id: "bluesky",
    name: "Bluesky",
    description: "Share posts to Bluesky",
    color: "bg-sky-500",
    connectionType: "oauth",
  },
  {
    id: "threads",
    name: "Threads",
    description: "Post to Threads",
    color: "bg-black",
    connectionType: "oauth",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    description: "Publish posts to your profile",
    color: "bg-blue-700",
    connectionType: "oauth",
  },
  {
    id: "pinterest",
    name: "Pinterest",
    description: "Create pins",
    color: "bg-red-600",
    connectionType: "oauth",
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Send messages to channels",
    color: "bg-blue-500",
    connectionType: "manual",
  },
  {
    id: "forem",
    name: "DEV/Forem",
    description: "Publish articles to DEV or a Forem",
    color: "bg-black",
    connectionType: "manual",
  },
];

export const SOCIAL_PLATFORM_IDS = ALL_SOCIAL_PLATFORMS.map((platform) => platform.id);

export function parseEnabledSocialProviderIds(value: string | undefined): Set<string> {
  const configured = (value ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);

  if (configured.includes("*")) return new Set(SOCIAL_PLATFORM_IDS);

  const supported = new Set(SOCIAL_PLATFORM_IDS);
  return new Set(configured.filter((id) => supported.has(id)));
}

const enabledSocialProviderIds = parseEnabledSocialProviderIds(process.env.NEXT_PUBLIC_ENABLED_SOCIAL_PROVIDERS);

/** Providers available for new connections in this deployment. Disabled by default. */
export const SOCIAL_PLATFORMS = ALL_SOCIAL_PLATFORMS.filter((platform) => enabledSocialProviderIds.has(platform.id));

export function isSocialPlatformEnabled(platformId: string): boolean {
  return enabledSocialProviderIds.has(platformId.toLowerCase());
}

/**
 * Canonical form of a stored platform identifier.
 *
 * Connected accounts created before the X rename still carry `"twitter"`, and
 * casing has not always been consistent. Anything that groups or labels by
 * platform must normalize first, or a single account ends up counted as two
 * platforms.
 */
export function normalizePlatformId(platformId: string): string {
  const normalized = platformId.toLowerCase();
  return normalized === "twitter" ? "x" : normalized;
}

/**
 * Get a platform configuration by ID
 */
export function getPlatformById(platformId: string): SocialPlatform | undefined {
  return ALL_SOCIAL_PLATFORMS.find((p) => p.id === platformId);
}

/** Display name for a stored platform identifier, tolerant of legacy values. */
export function getPlatformName(platformId: string): string {
  const normalized = normalizePlatformId(platformId);
  return getPlatformById(normalized)?.name ?? normalized;
}

/**
 * Groups accounts into per-platform counts, collapsing legacy platform ids.
 * Duplicates are significant: two accounts on the same platform count twice,
 * because each one is a separate publish.
 */
export function countAccountsByPlatform(accounts: Array<{ platform: string }> | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const account of accounts ?? []) {
    const platform = normalizePlatformId(account.platform);
    counts[platform] = (counts[platform] ?? 0) + 1;
  }
  return counts;
}

/**
 * Get a user-friendly display name for a connected account
 * Shows @username for platforms that use handles (X, Instagram, TikTok)
 * Falls back to display name, email, or platform account ID
 */
export function getAccountDisplayName(account: {
  platform: string;
  username: string | null;
  displayName: string | null;
  email: string | null;
  platformAccountId: string;
}): string {
  // For X (Twitter), Instagram, and TikTok, prefer showing @username
  if (
    (account.platform === "x" ||
      account.platform === "instagram" ||
      account.platform === "tiktok" ||
      account.platform === "bluesky" ||
      account.platform === "threads") &&
    account.username
  ) {
    return `@${account.username}`;
  }

  // For other platforms, try to get the most user-friendly name
  return (
    account.displayName ||
    (account.username ? `@${account.username}` : null) ||
    account.email ||
    account.platformAccountId
  );
}
