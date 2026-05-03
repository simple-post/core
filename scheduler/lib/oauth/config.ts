const BLUESKY_OAUTH_ISSUER = process.env.BLUESKY_OAUTH_ISSUER || "https://bsky.social";

export interface PlatformOAuthConfig {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  responseType: string;
  userInfoUrl: string;
  requiresPkce: boolean;
  requiresBasicAuth: boolean;
  requiresDpop: boolean;
}

const OAUTH_CONFIGS: Record<string, PlatformOAuthConfig> = {
  x: {
    authUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    clientId: process.env.X_CLIENT_ID || "",
    clientSecret: process.env.X_CLIENT_SECRET || "",
    scope: "tweet.read tweet.write users.read offline.access media.write",
    responseType: "code",
    userInfoUrl: "https://api.twitter.com/2/users/me?user.fields=profile_image_url,username,name",
    requiresPkce: true,
    requiresBasicAuth: true,
    requiresDpop: false,
  },
  facebook: {
    authUrl: "https://www.facebook.com/v25.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v25.0/oauth/access_token",
    clientId: process.env.FACEBOOK_CLIENT_ID || "",
    clientSecret: process.env.FACEBOOK_CLIENT_SECRET || "",
    scope: "public_profile,pages_show_list,pages_manage_posts,business_management",
    responseType: "code",
    userInfoUrl: "https://graph.facebook.com/me?fields=id,name,email,picture",
    requiresPkce: false,
    requiresBasicAuth: false,
    requiresDpop: false,
  },
  instagram: {
    authUrl: "https://www.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    clientId: process.env.INSTAGRAM_CLIENT_ID || "",
    clientSecret: process.env.INSTAGRAM_CLIENT_SECRET || "",
    scope: "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages",
    responseType: "code",
    userInfoUrl: "https://graph.instagram.com/me?fields=user_id,username,name,profile_picture_url,account_type",
    requiresPkce: false,
    requiresBasicAuth: false,
    requiresDpop: false,
  },
  tiktok: {
    authUrl: "https://www.tiktok.com/v2/auth/authorize",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    clientId: process.env.TIKTOK_CLIENT_KEY || "",
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || "",
    scope: "user.info.basic,video.upload,video.publish,user.info.profile",
    responseType: "code",
    userInfoUrl: "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username",
    requiresPkce: false,
    requiresBasicAuth: false,
    requiresDpop: false,
  },
  youtube: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    scope:
      "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/userinfo.profile",
    responseType: "code",
    userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    requiresPkce: false,
    requiresBasicAuth: false,
    requiresDpop: false,
  },
  bluesky: {
    authUrl: `${BLUESKY_OAUTH_ISSUER}/oauth/authorize`,
    tokenUrl: `${BLUESKY_OAUTH_ISSUER}/oauth/token`,
    clientId: process.env.BLUESKY_CLIENT_ID || "",
    clientSecret: process.env.BLUESKY_CLIENT_SECRET || "",
    scope: "atproto transition:generic",
    responseType: "code",
    userInfoUrl: "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile",
    requiresPkce: true,
    requiresBasicAuth: false,
    requiresDpop: true,
  },
  threads: {
    authUrl: "https://threads.net/oauth/authorize",
    tokenUrl: "https://graph.threads.net/oauth/access_token",
    clientId: process.env.THREADS_CLIENT_ID || "",
    clientSecret: process.env.THREADS_CLIENT_SECRET || "",
    scope: "threads_basic,threads_content_publish,threads_manage_replies",
    responseType: "code",
    userInfoUrl: "https://graph.threads.net/v1.0/me?fields=id,username,name,threads_profile_picture_url",
    requiresPkce: false,
    requiresBasicAuth: false,
    requiresDpop: false,
  },
  linkedin: {
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    clientId: process.env.LINKEDIN_CLIENT_ID || "",
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET || "",
    scope: "openid profile email w_member_social",
    responseType: "code",
    userInfoUrl: "https://api.linkedin.com/v2/userinfo",
    requiresPkce: false,
    requiresBasicAuth: false,
    requiresDpop: false,
  },
  pinterest: {
    authUrl: "https://www.pinterest.com/oauth/",
    tokenUrl: "https://api.pinterest.com/v5/oauth/token",
    clientId: process.env.PINTEREST_CLIENT_ID || "",
    clientSecret: process.env.PINTEREST_CLIENT_SECRET || "",
    scope: "pins:read,pins:write,boards:read,boards:write,user_accounts:read",
    responseType: "code",
    userInfoUrl: "https://api.pinterest.com/v5/user_account",
    requiresPkce: false,
    requiresBasicAuth: true,
    requiresDpop: false,
  },
};

export function getPlatformOAuthConfig(platform: string): PlatformOAuthConfig | undefined {
  return OAUTH_CONFIGS[platform];
}
