import crypto from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";

import { derToRaw } from "@simple-post/sdk";

import { authLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import type { Prisma } from "@prisma/client";

const PENDING_OAUTH_TTL_MS = 30 * 60 * 1000;
const BLUESKY_OAUTH_ISSUER = process.env.BLUESKY_OAUTH_ISSUER || "https://bsky.social";

// Token exchange configuration for each platform
const TOKEN_CONFIG: Record<
  string,
  {
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    userInfoUrl: string;
  }
> = {
  x: {
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    clientId: process.env.X_CLIENT_ID || "",
    clientSecret: process.env.X_CLIENT_SECRET || "",
    userInfoUrl: "https://api.twitter.com/2/users/me?user.fields=profile_image_url,username,name",
  },
  facebook: {
    tokenUrl: "https://graph.facebook.com/v24.0/oauth/access_token",
    clientId: process.env.FACEBOOK_CLIENT_ID || "",
    clientSecret: process.env.FACEBOOK_CLIENT_SECRET || "",
    userInfoUrl: "https://graph.facebook.com/me?fields=id,name,email,picture",
  },
  instagram: {
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    clientId: process.env.INSTAGRAM_CLIENT_ID || "",
    clientSecret: process.env.INSTAGRAM_CLIENT_SECRET || "",
    userInfoUrl: "https://graph.instagram.com/me?fields=user_id,username,name,profile_picture_url,account_type",
  },
  tiktok: {
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    clientId: process.env.TIKTOK_CLIENT_KEY || "",
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || "",
    userInfoUrl: "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username",
  },
  youtube: {
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
  },
  bluesky: {
    tokenUrl: `${BLUESKY_OAUTH_ISSUER}/oauth/token`,
    clientId: process.env.BLUESKY_CLIENT_ID || "",
    clientSecret: process.env.BLUESKY_CLIENT_SECRET || "",
    userInfoUrl: "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile",
  },
  threads: {
    tokenUrl: "https://graph.threads.net/oauth/access_token",
    clientId: process.env.THREADS_CLIENT_ID || "",
    clientSecret: process.env.THREADS_CLIENT_SECRET || "",
    userInfoUrl: "https://graph.threads.net/v1.0/me?fields=id,username,name,threads_profile_picture_url",
  },
  linkedin: {
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    clientId: process.env.LINKEDIN_CLIENT_ID || "",
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET || "",
    userInfoUrl: "https://api.linkedin.com/v2/userinfo",
  },
  pinterest: {
    tokenUrl: "https://api.pinterest.com/v5/oauth/token",
    clientId: process.env.PINTEREST_CLIENT_ID || "",
    clientSecret: process.env.PINTEREST_CLIENT_SECRET || "",
    userInfoUrl: "https://api.pinterest.com/v5/user_account",
  },
};

type OAuthTokenResponse = Record<string, unknown> & {
  access_token?: string;
  refresh_token?: string | null;
  expires_in?: number;
  scope?: string;
  sub?: string;
  user_id?: string;
};

const base64UrlEncode = (input: string | Buffer): string => Buffer.from(input).toString("base64url");

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

function createDpopProof({
  url,
  method,
  privateKey,
  publicJwk,
  nonce,
}: {
  url: string;
  method: string;
  privateKey: crypto.KeyObject;
  publicJwk: Record<string, unknown>;
  nonce?: string;
}): string {
  const header = {
    typ: "dpop+jwt",
    alg: "ES256",
    jwk: publicJwk,
  };

  const payload: Record<string, unknown> = {
    htu: url,
    htm: method.toUpperCase(),
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  };

  if (nonce) {
    payload.nonce = nonce;
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // Sign with ECDSA SHA-256 (ES256)
  const derSignature = crypto.sign("sha256", Buffer.from(signingInput), privateKey);

  // Convert DER signature to raw R||S format required by JWS
  const rawSignature = derToRaw(derSignature);

  return `${signingInput}.${base64UrlEncode(rawSignature)}`;
}

function generateDpopKeyPair(): {
  privateKey: crypto.KeyObject;
  publicJwk: Record<string, unknown>;
  privateJwk: Record<string, unknown>;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  const privateJwk = privateKey.export({ format: "jwk" }) as Record<string, unknown>;

  return { privateKey, publicJwk, privateJwk };
}

async function exchangeCodeForBlueskyToken(
  code: string,
  redirectUri: string,
  codeVerifier?: string,
): Promise<{
  tokenData: OAuthTokenResponse;
  dpopPublicJwk: Record<string, unknown>;
  dpopPrivateJwk: Record<string, unknown>;
}> {
  const config = TOKEN_CONFIG.bluesky;
  const { privateKey, publicJwk, privateJwk } = generateDpopKeyPair();

  const body = new URLSearchParams({
    client_id: config.clientId,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  if (codeVerifier) {
    body.set("code_verifier", codeVerifier);
  }

  // First request without nonce - Bluesky will return 401 with DPoP-Nonce header
  const initialDpopProof = createDpopProof({
    url: config.tokenUrl,
    method: "POST",
    privateKey,
    publicJwk,
  });

  const initialResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      DPoP: initialDpopProof,
    },
    body,
  });

  // Get the nonce from the response header
  const dpopNonce = initialResponse.headers.get("DPoP-Nonce");

  // If first request succeeded (unlikely but possible), return the result
  if (initialResponse.ok) {
    return {
      tokenData: await initialResponse.json(),
      dpopPublicJwk: publicJwk,
      dpopPrivateJwk: privateJwk,
    };
  }

  // Check if this is a nonce error (expected on first request)
  if (!dpopNonce) {
    const error = await initialResponse.text();
    authLogger.error(
      { platform: "bluesky", error, status: initialResponse.status },
      "Token exchange failed - no DPoP nonce received",
    );
    throw new Error(`Failed to exchange code for token: ${initialResponse.statusText}`);
  }

  // Retry with the nonce
  const dpopProofWithNonce = createDpopProof({
    url: config.tokenUrl,
    method: "POST",
    privateKey,
    publicJwk,
    nonce: dpopNonce,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      DPoP: dpopProofWithNonce,
    },
    body,
  });

  if (!response.ok) {
    const error = await response.text();
    authLogger.error(
      { platform: "bluesky", error, status: response.status },
      "Token exchange failed after nonce retry",
    );
    throw new Error(`Failed to exchange code for token: ${response.statusText}`);
  }

  return {
    tokenData: await response.json(),
    dpopPublicJwk: publicJwk,
    dpopPrivateJwk: privateJwk,
  };
}

async function exchangeCodeForToken(
  platform: string,
  code: string,
  redirectUri: string,
  codeVerifier?: string,
): Promise<OAuthTokenResponse> {
  const config = TOKEN_CONFIG[platform];

  const body: Record<string, string> = {
    client_id: config.clientId,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  };

  // Platform-specific adjustments
  switch (platform) {
    case "x": {
      // X requires PKCE code_verifier
      if (codeVerifier) {
        body.code_verifier = codeVerifier;
      }
      // X requires Basic Auth with client credentials (handled below)
      break;
    }
    case "tiktok": {
      body.client_key = config.clientId;
      body.client_secret = config.clientSecret;
      break;
    }
    case "instagram": {
      // Instagram API requires client_secret and grant_type
      body.client_secret = config.clientSecret;
      break;
    }
    case "pinterest": {
      body.client_secret = config.clientSecret;
      break;
    }
    default: {
      if (config.clientSecret) {
        body.client_secret = config.clientSecret;
      }
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // X requires Basic Auth
  if (platform === "x") {
    const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${credentials}`;
  }

  if (platform === "pinterest") {
    const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${credentials}`;
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body: new URLSearchParams(body),
  });

  if (!response.ok) {
    const error = await response.text();
    authLogger.error({ platform, error, status: response.status }, "Token exchange failed");
    throw new Error(`Failed to exchange code for token: ${response.statusText}`);
  }

  return await response.json();
}

async function fetchUserProfile(platform: string, accessToken: string) {
  const config = TOKEN_CONFIG[platform];

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };

  let response: Response;

  if (platform === "threads") {
    const url = new URL(config.userInfoUrl);
    url.searchParams.set("access_token", accessToken);
    response = await fetch(url.toString());
  } else {
    response = await fetch(config.userInfoUrl, { headers });
  }

  if (!response.ok) {
    const errorBody = await response.text();
    authLogger.warn(
      { platform, status: response.status, statusText: response.statusText, errorBody },
      "Failed to fetch user profile",
    );
    throw new Error(`Failed to fetch user profile: ${response.statusText}`);
  }

  const data = await response.json();

  // Parse platform-specific response format
  if (platform === "tiktok" && data.data?.user) {
    return data.data.user;
  }

  return data;
}

async function fetchBlueskyProfile(did: string) {
  const url = new URL(TOKEN_CONFIG.bluesky.userInfoUrl);
  url.searchParams.set("actor", did);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const error = await response.text();
    authLogger.error({ error, status: response.status }, "Failed to fetch Bluesky profile");
    throw new Error("Failed to fetch Bluesky profile");
  }

  return response.json();
}

async function fetchBlueskyPdsUrl(did: string): Promise<string | null> {
  try {
    const response = await fetch(`https://plc.directory/${did}`);
    if (!response.ok) return null;
    const data = await response.json();
    const services = Array.isArray(data.service) ? data.service : [];
    const pdsService = services.find(
      (service: { id?: string; type?: string }) =>
        service.id === "#atproto_pds" || service.type === "AtprotoPersonalDataServer",
    );
    return pdsService?.serviceEndpoint || null;
  } catch (error) {
    authLogger.warn({ error }, "Failed to resolve Bluesky PDS URL");
    return null;
  }
}

async function exchangeForLongLivedInstagramToken(
  shortLivedToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const config = TOKEN_CONFIG.instagram;
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", config.clientSecret);
  url.searchParams.set("access_token", shortLivedToken);

  const response = await fetch(url.toString());

  if (!response.ok) {
    const error = await response.text();
    authLogger.error({ error, status: response.status }, "Failed to exchange for long-lived Instagram token");
    throw new Error("Failed to get long-lived Instagram token");
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 5_184_000, // Default 60 days
  };
}

async function fetchInstagramProfile(accessToken: string) {
  const response = await fetch(
    `https://graph.instagram.com/me?fields=user_id,username,name,profile_picture_url,account_type&access_token=${accessToken}`,
  );

  if (!response.ok) {
    const error = await response.text();
    authLogger.error({ error, status: response.status }, "Failed to fetch Instagram profile");
    throw new Error("Failed to fetch Instagram profile");
  }

  return response.json();
}

async function fetchFacebookPages(accessToken: string) {
  const pagesResponse = await fetch(
    "https://graph.facebook.com/v24.0/me/accounts?fields=id,name,access_token,picture{url}",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!pagesResponse.ok) {
    throw new Error(`Failed to fetch Facebook pages: ${pagesResponse.statusText}`);
  }

  const pagesData = await pagesResponse.json();

  return (pagesData.data || []).map(
    (page: { id: string; name: string; access_token: string; picture?: { data?: { url?: string } } }) => ({
      id: page.id,
      name: page.name,
      accessToken: page.access_token,
      profilePicture: page.picture?.data?.url || null,
    }),
  );
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  try {
    const { platform } = await params;
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorReason = searchParams.get("error_reason");
    const errorDescription = searchParams.get("error_description");

    // Check for OAuth errors (Facebook sends error_reason and error_description)
    if (error || errorReason) {
      const errorMessage = errorDescription || errorReason || error || "Authorization failed";
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/accounts?error=${encodeURIComponent(errorMessage)}`,
      );
    }

    if (!code || !state) {
      // Log what we received for debugging
      authLogger.warn({ code: !!code, state: !!state, url: request.nextUrl.toString() }, "Missing OAuth params");
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/accounts?error=missing_params`);
    }

    // Verify state parameter
    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, "base64").toString());
    } catch {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/accounts?error=invalid_state`);
    }

    const { userId, platform: statePlatform, codeVerifier } = stateData;

    if (statePlatform !== platform) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/accounts?error=platform_mismatch`);
    }

    // Exchange code for access token
    const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const redirectUri = `${baseURL}/api/connect/callback/${platform}`;

    let tokenData: OAuthTokenResponse;
    let tokenMetadata: Prisma.InputJsonValue | null = null;

    if (platform === "bluesky") {
      const blueskyExchange = await exchangeCodeForBlueskyToken(code, redirectUri, codeVerifier);
      tokenData = blueskyExchange.tokenData;
      tokenMetadata = {
        dpopPublicJwk: blueskyExchange.dpopPublicJwk,
        dpopPrivateJwk: blueskyExchange.dpopPrivateJwk,
      } as Prisma.InputJsonValue;
    } else {
      tokenData = await exchangeCodeForToken(platform, code, redirectUri, codeVerifier);
    }

    // Extract tokens based on platform response format
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token || null;
    const expiresIn = tokenData.expires_in;
    const scope = tokenData.scope;

    if (!accessToken) {
      throw new Error("No access token received");
    }

    if (platform === "bluesky") {
      const payload = decodeJwtPayload(accessToken);
      const did = (tokenData.sub as string | undefined) || (payload?.sub as string | undefined);

      if (!did) {
        throw new Error("No Bluesky DID received");
      }

      const profile = await fetchBlueskyProfile(did);
      const platformAccountId = did;
      const username = profile.handle || null;
      const displayName = profile.displayName || profile.handle || null;
      const profilePicture = profile.avatar || null;
      const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
      const pdsUrl = (await fetchBlueskyPdsUrl(did)) || BLUESKY_OAUTH_ISSUER;

      if (tokenMetadata && typeof tokenMetadata === "object" && !Array.isArray(tokenMetadata)) {
        tokenMetadata = { ...tokenMetadata, pdsUrl } as Prisma.InputJsonValue;
      }

      await prisma.connectedAccount.upsert({
        where: {
          userId_platform_platformAccountId: {
            userId,
            platform: "bluesky",
            platformAccountId,
          },
        },
        create: {
          userId,
          platform: "bluesky",
          platformAccountId,
          accessToken,
          refreshToken,
          expiresAt,
          scope,
          username,
          displayName,
          email: null,
          profilePicture,
          tokenMetadata: (tokenMetadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
        update: {
          accessToken,
          refreshToken,
          expiresAt,
          scope,
          username,
          displayName,
          profilePicture,
          tokenMetadata: (tokenMetadata ?? undefined) as Prisma.InputJsonValue | undefined,
          updatedAt: new Date(),
        },
      });

      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/accounts?success=true&platform=bluesky`);
    }

    // Special handling for Instagram - use Instagram Login API directly
    if (platform === "instagram") {
      // Exchange short-lived token for long-lived token
      const { accessToken: longLivedToken, expiresIn: longLivedExpiresIn } =
        await exchangeForLongLivedInstagramToken(accessToken);

      // Fetch user profile from Instagram API
      const profile = await fetchInstagramProfile(longLivedToken);

      const platformAccountId = profile.user_id || profile.id;
      const username = profile.username;
      const displayName = profile.name || profile.username;
      const profilePicture = profile.profile_picture_url || null;
      const expiresAt = new Date(Date.now() + longLivedExpiresIn * 1000);

      await prisma.connectedAccount.upsert({
        where: {
          userId_platform_platformAccountId: {
            userId,
            platform: "instagram",
            platformAccountId,
          },
        },
        create: {
          userId,
          platform: "instagram",
          platformAccountId,
          accessToken: longLivedToken,
          refreshToken: null,
          expiresAt,
          scope,
          username,
          displayName,
          email: null,
          profilePicture,
        },
        update: {
          accessToken: longLivedToken,
          expiresAt,
          scope,
          username,
          displayName,
          profilePicture,
          updatedAt: new Date(),
        },
      });

      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/accounts?success=true&platform=instagram`);
    }

    // Special handling for Facebook - store pending account choices for picker
    if (platform === "facebook") {
      const accounts = await fetchFacebookPages(accessToken);

      if (accounts.length === 0) {
        return NextResponse.redirect(
          `${process.env.NEXT_PUBLIC_APP_URL}/accounts?error=no_accounts&message=${encodeURIComponent("No Facebook Pages found. Make sure you have a Facebook Page connected to your account.")}`,
        );
      }

      await prisma.pendingOAuthConnection.deleteMany({ where: { userId, platform } });

      const pending = await prisma.pendingOAuthConnection.create({
        data: {
          userId,
          platform,
          data: {
            accounts,
            scope,
          },
          expiresAt: new Date(Date.now() + PENDING_OAUTH_TTL_MS),
        },
      });

      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/accounts/connect/${platform}?pendingId=${pending.id}`,
      );
    }

    // Fetch user profile for other platforms
    let profile: any;
    try {
      profile = await fetchUserProfile(platform, accessToken);
    } catch (profileError) {
      // Threads: token exchange returns user_id; try fetching profile by user_id directly
      if (platform === "threads" && tokenData.user_id != null) {
        authLogger.info(
          { userId: tokenData.user_id },
          "Threads /me failed, trying direct user_id fetch (consider adding user as Threads Tester)",
        );
        try {
          const directUrl = new URL(`https://graph.threads.net/v1.0/${tokenData.user_id}`);
          directUrl.searchParams.set("fields", "id,username,name,threads_profile_picture_url");
          directUrl.searchParams.set("access_token", accessToken);
          const directResponse = await fetch(directUrl.toString());
          profile = directResponse.ok ? await directResponse.json() : { id: String(tokenData.user_id) };
        } catch {
          profile = { id: String(tokenData.user_id) };
        }
      } else {
        throw profileError;
      }
    }

    // Extract profile data based on platform
    let platformAccountId: string;
    let username: string | null = null;
    let displayName: string | null = null;
    let email: string | null = null;
    let profilePicture: string | null = null;

    switch (platform) {
      case "x": {
        platformAccountId = profile.data?.id || profile.id;
        username = profile.data?.username || profile.username;
        displayName = profile.data?.name || profile.name;
        profilePicture = profile.data?.profile_image_url || profile.profile_image_url || null;
        break;
      }
      case "facebook": {
        platformAccountId = profile.id;
        displayName = profile.name;
        email = profile.email;
        profilePicture = profile.picture?.data?.url || null;
        break;
      }
      case "tiktok": {
        platformAccountId = profile.open_id || profile.union_id;
        username = profile.username;
        displayName = profile.display_name;
        profilePicture = profile.avatar_url;
        break;
      }
      case "threads": {
        platformAccountId = profile.id || tokenData.user_id;
        username = profile.username || null;
        displayName = profile.name || profile.username || null;
        profilePicture = profile.threads_profile_picture_url || null;
        break;
      }
      case "linkedin": {
        // OpenID Connect userinfo response
        platformAccountId = profile.sub || profile.id;
        username = profile.email || null;
        displayName = profile.name || profile.given_name || null;
        email = profile.email || null;
        profilePicture = profile.picture || null;
        break;
      }
      case "pinterest": {
        platformAccountId = profile.id || profile.username;
        username = profile.username || null;
        displayName = profile.profile_name || profile.business_name || profile.username || null;
        profilePicture = profile.profile_image?.url || profile.profile_image || null;
        break;
      }
      case "youtube": {
        platformAccountId = profile.id || profile.sub;
        displayName = profile.name;
        email = profile.email;
        profilePicture = profile.picture;
        break;
      }
      default: {
        platformAccountId = profile.id || profile.sub;
      }
    }

    // Store or update connected account
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

    await prisma.connectedAccount.upsert({
      where: {
        userId_platform_platformAccountId: {
          userId,
          platform,
          platformAccountId,
        },
      },
      create: {
        userId,
        platform,
        platformAccountId,
        accessToken,
        refreshToken,
        expiresAt,
        scope,
        username,
        displayName,
        email,
        profilePicture,
      },
      update: {
        accessToken,
        refreshToken,
        expiresAt,
        scope,
        username,
        displayName,
        email,
        profilePicture,
        updatedAt: new Date(),
      },
    });

    // Redirect back to accounts page
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/accounts?success=true&platform=${platform}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/accounts?error=${encodeURIComponent(errorMessage)}`,
    );
  }
}
