import { supportsAccountAnalytics, supportsPostAnalytics, type AnalyticsStatus } from "@simple-post/sdk/analytics";
import { mapPlatformName } from "@simple-post/sdk/platform-names";

/**
 * Extra OAuth scopes each platform needs before it returns analytics. They are
 * only requested for platforms listed in OAUTH_ANALYTICS_SCOPES, because
 * asking for a permission that the platform has not approved for the app makes
 * the whole login fail (see docs/post-analytics/platform-permissions.md).
 */
export const ANALYTICS_OAUTH_SCOPES: Partial<Record<string, string[]>> = {
  facebook: ["pages_read_engagement", "read_insights"],
  instagram: ["instagram_business_manage_insights"],
  threads: ["threads_manage_insights"],
  tiktok: ["video.list", "user.info.stats"],
  linkedin: ["r_member_postAnalytics", "r_member_profileAnalytics"],
  youtube: ["https://www.googleapis.com/auth/yt-analytics.readonly"],
};

/**
 * Scopes without which post analytics cannot be read at all. Platforms not
 * listed work with the scopes SimplePost already requests (or degrade to
 * public counters, like Facebook and Instagram without insights).
 */
const REQUIRED_POST_SCOPES: Partial<Record<string, string[]>> = {
  threads: ["threads_manage_insights"],
  tiktok: ["video.list"],
  linkedin: ["r_member_postAnalytics"],
  facebook: ["pages_read_engagement"],
  pinterest: ["pins:read"],
};

/** Scopes that unlock additional metrics (views, reach, …) on top of basic counters. */
const RECOMMENDED_POST_SCOPES: Partial<Record<string, string[]>> = {
  facebook: ["read_insights"],
  instagram: ["instagram_business_manage_insights", "instagram_manage_insights"],
};

function enabledPlatforms(): Set<string> {
  const raw = (process.env.OAUTH_ANALYTICS_SCOPES ?? "").trim().toLowerCase();
  if (!raw) return new Set();
  if (raw === "all" || raw === "true") return new Set(Object.keys(ANALYTICS_OAUTH_SCOPES));
  return new Set(raw.split(/[\s,]+/).filter(Boolean));
}

/** Appends the platform's analytics scopes when enabled, using the scope string's own separator. */
export function withAnalyticsScopes(platform: string, scope: string): string {
  const extra = ANALYTICS_OAUTH_SCOPES[platform];
  if (!extra || !enabledPlatforms().has(platform)) return scope;
  const separator = scope.includes(",") ? "," : " ";
  const current = scope.split(separator).filter(Boolean);
  return [...current, ...extra.filter((entry) => !current.includes(entry))].join(separator);
}

export function analyticsScopesEnabled(platform: string): boolean {
  return !ANALYTICS_OAUTH_SCOPES[platform] || enabledPlatforms().has(platform);
}

function grantedScopes(scope: string | null | undefined): Set<string> | null {
  if (!scope) return null;
  return new Set(scope.split(/[\s,]+/).filter(Boolean));
}

export interface AnalyticsReadiness {
  ready: boolean;
  status: AnalyticsStatus;
  message: string;
  /** Scopes the stored grant lacks (empty when unknown or complete). */
  missingScopes: string[];
  /** Whether reconnecting the account could unlock (more) analytics right now. */
  reconnectRecommended: boolean;
}

/**
 * Decides from the stored grant whether reading analytics can work. Unknown
 * grants (no scope recorded) are attempted; the provider then answers.
 */
export function analyticsAccountReadiness(account: {
  platform: string;
  scope: string | null;
  tokenMetadata?: unknown;
}): AnalyticsReadiness {
  const platform = mapPlatformName(account.platform);
  const metadata = account.tokenMetadata as { previewOnly?: unknown } | null | undefined;
  if (metadata && typeof metadata === "object" && metadata.previewOnly === true) {
    return {
      ready: false,
      status: "unsupported",
      message: "Preview accounts have no analytics.",
      missingScopes: [],
      reconnectRecommended: false,
    };
  }
  if (!supportsPostAnalytics(platform)) {
    return {
      ready: false,
      status: "unsupported",
      message:
        platform === "telegram"
          ? "Telegram bots cannot read message views or reactions."
          : "This platform does not provide post analytics.",
      missingScopes: [],
      reconnectRecommended: false,
    };
  }

  const granted = grantedScopes(account.scope);
  const required = REQUIRED_POST_SCOPES[platform] ?? [];
  const recommended = RECOMMENDED_POST_SCOPES[platform] ?? [];
  const missingRequired = granted ? required.filter((scope) => !granted.has(scope)) : [];
  // Instagram has two logins with different names for the same permission; either is enough.
  const missingRecommended =
    granted && recommended.length > 0 && !recommended.some((scope) => granted.has(scope))
      ? platform === "instagram"
        ? [recommended[0]]
        : recommended.filter((scope) => !granted.has(scope))
      : [];
  const canReconnect = analyticsScopesEnabled(platform);

  if (missingRequired.length > 0) {
    return {
      ready: false,
      status: "missing_permission",
      message: canReconnect
        ? `Reconnect this account to allow SimplePost to read analytics (missing ${missingRequired.join(", ")}).`
        : `Analytics for this platform are not enabled on this SimplePost installation yet (needs ${missingRequired.join(", ")}).`,
      missingScopes: missingRequired,
      reconnectRecommended: canReconnect,
    };
  }

  return {
    ready: true,
    status: "ok",
    message:
      missingRecommended.length > 0
        ? canReconnect
          ? "Reconnect this account to include views and reach."
          : "Views and reach need an additional permission that this installation does not request yet."
        : "",
    missingScopes: missingRecommended,
    reconnectRecommended: missingRecommended.length > 0 && canReconnect,
  };
}

/** Account-level analytics need these scopes in addition to the post requirements. */
const REQUIRED_ACCOUNT_SCOPES: Partial<Record<string, string[]>> = {
  tiktok: ["user.info.stats"],
  linkedin: ["r_member_profileAnalytics"],
};

export function accountAnalyticsReadiness(account: { platform: string; scope: string | null }): {
  ready: boolean;
  message?: string;
} {
  const platform = mapPlatformName(account.platform);
  if (!supportsAccountAnalytics(platform)) return { ready: false, message: "Not available for this platform." };
  const granted = grantedScopes(account.scope);
  const missing = granted ? (REQUIRED_ACCOUNT_SCOPES[platform] ?? []).filter((scope) => !granted.has(scope)) : [];
  return missing.length > 0
    ? { ready: false, message: `Reconnect this account to read followers (missing ${missing.join(", ")}).` }
    : { ready: true };
}
