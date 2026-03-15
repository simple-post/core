import crypto from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";

import { derToRaw } from "@simple-post/sdk";

import { authLogger } from "@/lib/logger";
import { requireAuth } from "@/lib/middleware/auth";
import {
  getPlatformOAuthConfig,
  verifyOAuthState,
  getPkceVerifier,
  clearPkceCookie,
  upsertConnectedAccount,
  getErrorRedirectUrl,
  mapErrorToCode,
} from "@/lib/oauth";
import { OAuthStateError } from "@/lib/oauth/state";
import { prisma } from "@/lib/prisma";

import type { Prisma } from "@prisma/client";

const PENDING_OAUTH_TTL_MS = 30 * 60 * 1000;
const BLUESKY_OAUTH_ISSUER = process.env.BLUESKY_OAUTH_ISSUER || "https://bsky.social";

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

  const derSignature = crypto.sign("sha256", Buffer.from(signingInput), privateKey);
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
  const config = getPlatformOAuthConfig("bluesky")!;
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

  const dpopNonce = initialResponse.headers.get("DPoP-Nonce");

  if (initialResponse.ok) {
    return {
      tokenData: await initialResponse.json(),
      dpopPublicJwk: publicJwk,
      dpopPrivateJwk: privateJwk,
    };
  }

  if (!dpopNonce) {
    authLogger.error(
      { platform: "bluesky", status: initialResponse.status },
      "Token exchange failed - no DPoP nonce received",
    );
    throw new Error(`Failed to exchange code for token: ${initialResponse.statusText}`);
  }

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
    authLogger.error(
      { platform: "bluesky", status: response.status },
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
  const config = getPlatformOAuthConfig(platform)!;

  const body: Record<string, string> = {
    client_id: config.clientId,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  };

  switch (platform) {
    case "x": {
      if (codeVerifier) {
        body.code_verifier = codeVerifier;
      }
      break;
    }
    case "tiktok": {
      body.client_key = config.clientId;
      body.client_secret = config.clientSecret;
      break;
    }
    case "instagram": {
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

  if (config.requiresBasicAuth) {
    const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${credentials}`;
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body: new URLSearchParams(body),
  });

  if (!response.ok) {
    authLogger.error({ platform, status: response.status, statusText: response.statusText }, "Token exchange failed");
    throw new Error(`Failed to exchange code for token: ${response.statusText}`);
  }

  return await response.json();
}

async function fetchUserProfile(platform: string, accessToken: string) {
  const config = getPlatformOAuthConfig(platform)!;

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
    authLogger.warn(
      { platform, status: response.status, statusText: response.statusText },
      "Failed to fetch user profile",
    );
    throw new Error(`Failed to fetch user profile: ${response.statusText}`);
  }

  const data = await response.json();

  if (platform === "tiktok" && data.data?.user) {
    return data.data.user;
  }

  return data;
}

async function fetchBlueskyProfile(did: string) {
  const config = getPlatformOAuthConfig("bluesky")!;
  const url = new URL(config.userInfoUrl);
  url.searchParams.set("actor", did);

  const response = await fetch(url.toString());
  if (!response.ok) {
    authLogger.error({ status: response.status }, "Failed to fetch Bluesky profile");
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
  const config = getPlatformOAuthConfig("instagram")!;
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", config.clientSecret);
  url.searchParams.set("access_token", shortLivedToken);

  const response = await fetch(url.toString());

  if (!response.ok) {
    authLogger.error({ status: response.status }, "Failed to exchange for long-lived Instagram token");
    throw new Error("Failed to get long-lived Instagram token");
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 5_184_000,
  };
}

async function fetchInstagramProfile(accessToken: string) {
  const response = await fetch(
    `https://graph.instagram.com/me?fields=user_id,username,name,profile_picture_url,account_type&access_token=${accessToken}`,
  );

  if (!response.ok) {
    authLogger.error({ status: response.status }, "Failed to fetch Instagram profile");
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
  const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  try {
    const { platform } = await params;
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorReason = searchParams.get("error_reason");
    const errorDescription = searchParams.get("error_description");

    if (error || errorReason) {
      authLogger.warn({ platform, error, errorReason, errorDescription }, "OAuth provider returned error");
      return NextResponse.redirect(getErrorRedirectUrl("authorization_denied", baseURL));
    }

    if (!code || !state) {
      authLogger.warn({ hasCode: !!code, hasState: !!state, platform }, "Missing OAuth params");
      return NextResponse.redirect(getErrorRedirectUrl("missing_params", baseURL));
    }

    // Verify HMAC-signed state and check expiry
    let stateData;
    try {
      stateData = verifyOAuthState(state);
    } catch (stateError) {
      if (stateError instanceof OAuthStateError) {
        return NextResponse.redirect(getErrorRedirectUrl(stateError.code as "invalid_state" | "state_expired", baseURL));
      }
      return NextResponse.redirect(getErrorRedirectUrl("invalid_state", baseURL));
    }

    const { userId, platform: statePlatform } = stateData;

    if (statePlatform !== platform) {
      return NextResponse.redirect(getErrorRedirectUrl("platform_mismatch", baseURL));
    }

    // Validate session matches state userId
    const session = await requireAuth(request);
    if (session.user.id !== userId) {
      authLogger.warn({ stateUserId: userId, sessionUserId: session.user.id }, "OAuth session mismatch");
      return NextResponse.redirect(getErrorRedirectUrl("session_mismatch", baseURL));
    }

    const config = getPlatformOAuthConfig(platform);
    if (!config) {
      return NextResponse.redirect(getErrorRedirectUrl("unknown_error", baseURL));
    }

    // Read PKCE verifier from encrypted cookie
    let codeVerifier: string | undefined;
    if (config.requiresPkce) {
      const verifier = getPkceVerifier(request, platform);
      if (!verifier) {
        return NextResponse.redirect(getErrorRedirectUrl("pkce_missing", baseURL));
      }
      codeVerifier = verifier;
    }

    // Exchange code for access token
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

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token || null;
    const expiresIn = tokenData.expires_in;
    const scope = tokenData.scope;

    if (!accessToken) {
      return NextResponse.redirect(getErrorRedirectUrl("no_access_token", baseURL));
    }

    // --- Platform-specific handling ---

    if (platform === "bluesky") {
      const payload = decodeJwtPayload(accessToken);
      const did = (tokenData.sub as string | undefined) || (payload?.sub as string | undefined);

      if (!did) {
        throw new Error("No Bluesky DID received");
      }

      const profile = await fetchBlueskyProfile(did);
      const pdsUrl = (await fetchBlueskyPdsUrl(did)) || BLUESKY_OAUTH_ISSUER;

      if (tokenMetadata && typeof tokenMetadata === "object" && !Array.isArray(tokenMetadata)) {
        tokenMetadata = { ...tokenMetadata, pdsUrl } as Prisma.InputJsonValue;
      }

      await upsertConnectedAccount({
        userId,
        platform: "bluesky",
        platformAccountId: did,
        accessToken,
        refreshToken,
        expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
        scope: scope ?? null,
        username: profile.handle || null,
        displayName: profile.displayName || profile.handle || null,
        email: null,
        profilePicture: profile.avatar || null,
        tokenMetadata: tokenMetadata ?? undefined,
      });

      const response = NextResponse.redirect(`${baseURL}/accounts?success=true&platform=bluesky`);
      clearPkceCookie(response, platform);
      return response;
    }

    if (platform === "instagram") {
      const { accessToken: longLivedToken, expiresIn: longLivedExpiresIn } =
        await exchangeForLongLivedInstagramToken(accessToken);
      const profile = await fetchInstagramProfile(longLivedToken);

      await upsertConnectedAccount({
        userId,
        platform: "instagram",
        platformAccountId: profile.user_id || profile.id,
        accessToken: longLivedToken,
        refreshToken: null,
        expiresAt: new Date(Date.now() + longLivedExpiresIn * 1000),
        scope: scope ?? null,
        username: profile.username,
        displayName: profile.name || profile.username,
        email: null,
        profilePicture: profile.profile_picture_url || null,
      });

      return NextResponse.redirect(`${baseURL}/accounts?success=true&platform=instagram`);
    }

    if (platform === "facebook") {
      const accounts = await fetchFacebookPages(accessToken);

      if (accounts.length === 0) {
        return NextResponse.redirect(
          `${baseURL}/accounts?error=${encodeURIComponent("No Facebook Pages found. Make sure you have a Facebook Page connected to your account.")}`,
        );
      }

      await prisma.pendingOAuthConnection.deleteMany({ where: { userId, platform } });

      const pending = await prisma.pendingOAuthConnection.create({
        data: {
          userId,
          platform,
          data: { accounts, scope },
          expiresAt: new Date(Date.now() + PENDING_OAUTH_TTL_MS),
        },
      });

      return NextResponse.redirect(`${baseURL}/accounts/connect/${platform}?pendingId=${pending.id}`);
    }

    // Generic flow for remaining platforms
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external API responses from multiple platforms
    let profile: any;
    try {
      profile = await fetchUserProfile(platform, accessToken);
    } catch (profileError) {
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

    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

    await upsertConnectedAccount({
      userId,
      platform,
      platformAccountId,
      accessToken,
      refreshToken,
      expiresAt,
      scope: scope ?? null,
      username,
      displayName,
      email,
      profilePicture,
    });

    const successResponse = NextResponse.redirect(`${baseURL}/accounts?success=true&platform=${platform}`);
    if (config.requiresPkce) {
      clearPkceCookie(successResponse, platform);
    }
    return successResponse;
  } catch (error) {
    const code = mapErrorToCode(error);
    const response = NextResponse.redirect(getErrorRedirectUrl(code, baseURL));
    return response;
  }
}
