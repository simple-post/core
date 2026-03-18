import { DEFAULT_OAUTH_REDIRECT_URI, DEFAULT_X_SCOPES } from "../constants.js";

import type { Platform } from "@simple-post/sdk";

export type AccountPlatform = Exclude<Platform, "pinterest">;

export interface EmbeddedOAuthAppConfig {
  authorizationUrl: string;
  clientId: string;
  clientIdAuthorizeParameter?: string;
  clientIdTokenParameter?: string;
  clientSecret?: string;
  clientSecretEnvVar?: string;
  clientSecretRequired?: boolean;
  extraAuthorizationParams?: Record<string, string>;
  pkce: boolean;
  redirectUri: string;
  redirectUriEnvVar?: string;
  scopeSeparator?: " " | ",";
  scopes: string[];
  tokenAuthMethod?: "basic" | "client_secret_post" | "none";
  tokenMetadataUrl?: string;
  tokenUrl: string;
}

export interface AccountPlatformConfig {
  connectDescription: string;
  displayName: string;
  oauthApp?: EmbeddedOAuthAppConfig;
  platform: AccountPlatform;
}

const ACCOUNT_PLATFORM_CONFIGS = {
  x: {
    connectDescription: "Post and refresh tokens with the bundled X native app.",
    displayName: "X",
    oauthApp: {
      authorizationUrl: "https://x.com/i/oauth2/authorize",
      clientId: "NVlUaE1fc1hkeVRrTXlkOElDc186MTpjaQ",
      pkce: true,
      redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
      redirectUriEnvVar: "SIMPLE_POST_X_REDIRECT_URI",
      scopes: DEFAULT_X_SCOPES,
      tokenAuthMethod: "none",
      tokenUrl: "https://api.x.com/2/oauth2/token",
    },
    platform: "x",
  },
  youtube: {
    connectDescription: "Upload to YouTube with the bundled Google app.",
    displayName: "YouTube",
    oauthApp: {
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      clientId: "555578778355-27at3vf6abehns8l6lgnt2rppvc3lah1.apps.googleusercontent.com",
      clientSecret: "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",
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
    connectDescription: "Connect a Facebook Page and store the page access token locally.",
    displayName: "Facebook",
    oauthApp: {
      authorizationUrl: "https://www.facebook.com/v24.0/dialog/oauth",
      clientId: "1151205170264557",
      clientSecretEnvVar: "FACEBOOK_CLIENT_SECRET",
      clientSecretRequired: true,
      pkce: false,
      redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
      scopes: ["public_profile", "pages_show_list", "pages_manage_posts", "business_management"],
      tokenAuthMethod: "client_secret_post",
      tokenUrl: "https://graph.facebook.com/v24.0/oauth/access_token",
    },
    platform: "facebook",
  },
  instagram: {
    connectDescription: "Connect an Instagram business account through Instagram Login.",
    displayName: "Instagram",
    oauthApp: {
      authorizationUrl: "https://www.instagram.com/oauth/authorize",
      clientId: "1458767782086183",
      clientSecretEnvVar: "INSTAGRAM_CLIENT_SECRET",
      clientSecretRequired: true,
      extraAuthorizationParams: {
        enable_fb_login: "0",
        force_authentication: "1",
      },
      pkce: false,
      redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
      scopes: ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_messages"],
      tokenAuthMethod: "client_secret_post",
      tokenUrl: "https://api.instagram.com/oauth/access_token",
    },
    platform: "instagram",
  },
  tiktok: {
    connectDescription: "Connect TikTok for direct publishing with the bundled app key.",
    displayName: "TikTok",
    oauthApp: {
      authorizationUrl: "https://www.tiktok.com/v2/auth/authorize",
      clientId: "sbawif7b013dnnr3a5",
      clientIdAuthorizeParameter: "client_key",
      clientIdTokenParameter: "client_key",
      clientSecretEnvVar: "TIKTOK_CLIENT_SECRET",
      clientSecretRequired: true,
      pkce: false,
      redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
      scopes: ["user.info.basic", "video.upload", "video.publish", "user.info.profile"],
      tokenAuthMethod: "client_secret_post",
      tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    },
    platform: "tiktok",
  },
  bluesky: {
    connectDescription: "Connect Bluesky with the bundled OAuth client metadata.",
    displayName: "Bluesky",
    oauthApp: {
      authorizationUrl: "https://bsky.social/oauth/authorize",
      clientId: "https://simplepost.dev/oauth/client-native-metadata.json",
      pkce: true,
      redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
      redirectUriEnvVar: "SIMPLE_POST_BLUESKY_REDIRECT_URI",
      scopes: ["atproto", "transition:generic"],
      tokenAuthMethod: "none",
      tokenMetadataUrl: "https://simplepost.dev/oauth/client-native-metadata.json",
      tokenUrl: "https://bsky.social/oauth/token",
    },
    platform: "bluesky",
  },
  threads: {
    connectDescription: "Connect Threads for text and media publishing.",
    displayName: "Threads",
    oauthApp: {
      authorizationUrl: "https://threads.net/oauth/authorize",
      clientId: "2145167062973162",
      clientSecretEnvVar: "THREADS_CLIENT_SECRET",
      clientSecretRequired: true,
      pkce: false,
      redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
      scopes: ["threads_basic", "threads_content_publish"],
      tokenAuthMethod: "client_secret_post",
      tokenUrl: "https://graph.threads.net/oauth/access_token",
    },
    platform: "threads",
  },
  linkedin: {
    connectDescription: "Connect LinkedIn for member posts.",
    displayName: "LinkedIn",
    oauthApp: {
      authorizationUrl: "https://www.linkedin.com/oauth/v2/authorization",
      clientId: "77p2yp9zm7f6kg",
      clientSecretEnvVar: "LINKEDIN_CLIENT_SECRET",
      pkce: true,
      redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
      scopes: ["openid", "profile", "email", "w_member_social"],
      tokenAuthMethod: "client_secret_post",
      tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    },
    platform: "linkedin",
  },
  telegram: {
    connectDescription: "Connect a Telegram bot and chat/channel with bot token and chat ID.",
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
