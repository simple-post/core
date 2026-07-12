import { DEFAULT_OAUTH_REDIRECT_URI, META_OAUTH_REDIRECT_URI } from "../constants.js";

import type { Platform } from "@simple-post/sdk";

export type AccountPlatform = Platform;

/**
 * Protocol description of a platform's OAuth flow. The CLI never ships its
 * own client credentials: the client ID and (when needed) client secret
 * always come from the user's environment. See `resolveOAuthAppInputs`.
 */
export interface OAuthAppConfig {
  authorizationUrl: string;
  clientIdAuthorizeParameter?: string;
  clientIdTokenParameter?: string;
  /** Whether the platform's token endpoint requires a client secret. */
  clientSecretRequired: boolean;
  /** Where the user registers their own developer app. */
  developerPortalUrl: string;
  extraAuthorizationParams?: Record<string, string>;
  pkce: boolean;
  /** RFC 7636 uses base64url; TikTok Login Kit for desktop expects hex-encoded SHA-256. */
  pkceChallengeEncoding?: "base64url" | "hex";
  redirectUri: string;
  scopeSeparator?: " " | ",";
  scopes: string[];
  /**
   * How the client secret is sent when one is available. Platforms without
   * it (custom exchanges like Meta OIDC + PKCE or Bluesky) never use a secret.
   */
  tokenAuthMethod?: "basic" | "client_secret_post";
  tokenUrl: string;
}

export interface AccountPlatformConfig {
  connectDescription: string;
  displayName: string;
  oauthApp?: OAuthAppConfig;
  platform: AccountPlatform;
}

const DEFAULT_X_SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"];

const ACCOUNT_PLATFORM_CONFIGS = {
  x: {
    connectDescription: "Connect X with your own X developer app.",
    displayName: "X",
    oauthApp: {
      authorizationUrl: "https://x.com/i/oauth2/authorize",
      clientSecretRequired: false,
      developerPortalUrl: "https://developer.x.com/en/portal/dashboard",
      pkce: true,
      redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
      scopes: DEFAULT_X_SCOPES,
      tokenAuthMethod: "basic",
      tokenUrl: "https://api.x.com/2/oauth2/token",
    },
    platform: "x",
  },
  youtube: {
    connectDescription: "Upload to YouTube with your own Google Cloud OAuth app.",
    displayName: "YouTube",
    oauthApp: {
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      clientSecretRequired: true,
      developerPortalUrl: "https://console.cloud.google.com/apis/credentials",
      extraAuthorizationParams: {
        access_type: "offline",
        prompt: "consent",
      },
      pkce: true,
      redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
      scopes: [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/userinfo.profile",
      ],
      tokenAuthMethod: "client_secret_post",
      tokenUrl: "https://oauth2.googleapis.com/token",
    },
    platform: "youtube",
  },
  facebook: {
    connectDescription: "Connect a Facebook Page with your own Meta developer app.",
    displayName: "Facebook",
    oauthApp: {
      authorizationUrl: "https://www.facebook.com/v25.0/dialog/oauth",
      clientSecretRequired: false,
      developerPortalUrl: "https://developers.facebook.com/apps",
      pkce: true,
      redirectUri: META_OAUTH_REDIRECT_URI,
      scopes: ["openid", "public_profile", "pages_show_list", "pages_manage_posts", "business_management"],
      tokenUrl: "https://graph.facebook.com/v25.0/oauth/access_token",
    },
    platform: "facebook",
  },
  instagram: {
    connectDescription: "Connect Instagram via Facebook Login with your own Meta developer app.",
    displayName: "Instagram",
    oauthApp: {
      authorizationUrl: "https://www.facebook.com/v25.0/dialog/oauth",
      clientSecretRequired: false,
      developerPortalUrl: "https://developers.facebook.com/apps",
      pkce: true,
      redirectUri: META_OAUTH_REDIRECT_URI,
      scopes: [
        "openid",
        "public_profile",
        "pages_show_list",
        "pages_manage_posts",
        "business_management",
        "instagram_basic",
        "instagram_content_publish",
        "pages_read_engagement",
      ],
      tokenUrl: "https://graph.facebook.com/v25.0/oauth/access_token",
    },
    platform: "instagram",
  },
  tiktok: {
    connectDescription: "Connect TikTok with your own TikTok developer app.",
    displayName: "TikTok",
    oauthApp: {
      authorizationUrl: "https://www.tiktok.com/v2/auth/authorize/",
      clientIdAuthorizeParameter: "client_key",
      clientIdTokenParameter: "client_key",
      clientSecretRequired: true,
      developerPortalUrl: "https://developers.tiktok.com/apps",
      pkce: true,
      pkceChallengeEncoding: "hex",
      redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
      scopeSeparator: ",",
      scopes: ["video.upload", "video.publish"],
      tokenAuthMethod: "client_secret_post",
      tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    },
    platform: "tiktok",
  },
  bluesky: {
    connectDescription: "Connect Bluesky with your own hosted OAuth client metadata.",
    displayName: "Bluesky",
    oauthApp: {
      authorizationUrl: "https://bsky.social/oauth/authorize",
      clientSecretRequired: false,
      developerPortalUrl: "https://atproto.com/specs/oauth",
      pkce: true,
      redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
      scopes: ["atproto", "transition:generic"],
      tokenUrl: "https://bsky.social/oauth/token",
    },
    platform: "bluesky",
  },
  threads: {
    connectDescription: "Connect Threads with your own Meta developer app.",
    displayName: "Threads",
    oauthApp: {
      authorizationUrl: "https://threads.net/oauth/authorize",
      clientSecretRequired: true,
      developerPortalUrl: "https://developers.facebook.com/apps",
      pkce: false,
      redirectUri: META_OAUTH_REDIRECT_URI,
      scopes: ["threads_basic", "threads_content_publish"],
      tokenAuthMethod: "client_secret_post",
      tokenUrl: "https://graph.threads.net/oauth/access_token",
    },
    platform: "threads",
  },
  linkedin: {
    connectDescription: "Connect LinkedIn with your own LinkedIn developer app.",
    displayName: "LinkedIn",
    oauthApp: {
      authorizationUrl: "https://www.linkedin.com/oauth/v2/authorization",
      clientSecretRequired: true,
      developerPortalUrl: "https://www.linkedin.com/developers/apps",
      pkce: false,
      redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
      scopes: ["openid", "profile", "email", "w_member_social"],
      tokenAuthMethod: "client_secret_post",
      tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    },
    platform: "linkedin",
  },
  pinterest: {
    connectDescription: "Connect Pinterest with your own Pinterest developer app.",
    displayName: "Pinterest",
    oauthApp: {
      authorizationUrl: "https://www.pinterest.com/oauth/",
      clientSecretRequired: true,
      developerPortalUrl: "https://developers.pinterest.com/apps",
      pkce: false,
      redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
      scopes: ["pins:write", "boards:read", "user_accounts:read"],
      tokenAuthMethod: "basic",
      tokenUrl: "https://api.pinterest.com/v5/oauth/token",
    },
    platform: "pinterest",
  },
  tumblr: {
    connectDescription: "Connect a Tumblr blog with your own Tumblr application.",
    displayName: "Tumblr",
    oauthApp: {
      authorizationUrl: "https://www.tumblr.com/oauth2/authorize",
      clientSecretRequired: true,
      developerPortalUrl: "https://www.tumblr.com/oauth/apps",
      pkce: false,
      redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
      scopes: ["basic", "write", "offline_access"],
      tokenAuthMethod: "client_secret_post",
      tokenUrl: "https://api.tumblr.com/v2/oauth2/token",
    },
    platform: "tumblr",
  },
  telegram: {
    connectDescription: "Connect a Telegram bot and chat/channel with a bot token and chat ID.",
    displayName: "Telegram",
    platform: "telegram",
  },
} satisfies Record<AccountPlatform, AccountPlatformConfig>;

export function getAccountPlatformConfig(platform: AccountPlatform): AccountPlatformConfig {
  return ACCOUNT_PLATFORM_CONFIGS[platform];
}

export function getAccountPlatformOptions(): Array<{
  description: string;
  label: string;
  value: AccountPlatform;
}> {
  return (Object.values(ACCOUNT_PLATFORM_CONFIGS) as AccountPlatformConfig[]).map((platform) => ({
    description: platform.connectDescription,
    label: platform.displayName,
    value: platform.platform,
  }));
}

export function getAccountPlatformValues(): AccountPlatform[] {
  return Object.keys(ACCOUNT_PLATFORM_CONFIGS) as AccountPlatform[];
}

export function isAccountPlatform(value: string): value is AccountPlatform {
  return value in ACCOUNT_PLATFORM_CONFIGS;
}

export function getClientIdEnvVar(platform: AccountPlatform): string {
  return `SIMPLE_POST_${platform.toUpperCase()}_CLIENT_ID`;
}

export function getClientSecretEnvVar(platform: AccountPlatform): string {
  return `SIMPLE_POST_${platform.toUpperCase()}_CLIENT_SECRET`;
}

export function getRedirectUriEnvVar(platform: AccountPlatform): string {
  return `SIMPLE_POST_${platform.toUpperCase()}_REDIRECT_URI`;
}

/** True when the environment carries the user's own OAuth app for the platform. */
export function hasOAuthAppEnvConfig(platform: AccountPlatform): boolean {
  const config = getAccountPlatformConfig(platform).oauthApp;
  if (!config) {
    return false;
  }

  if (!process.env[getClientIdEnvVar(platform)]) {
    return false;
  }

  return config.clientSecretRequired ? Boolean(process.env[getClientSecretEnvVar(platform)]) : true;
}
