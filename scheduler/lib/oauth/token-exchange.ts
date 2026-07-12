import crypto from "node:crypto";

import { derToRaw } from "@simple-post/sdk";

import { authLogger } from "@/lib/logger";
import { getPlatformOAuthConfig } from "@/lib/oauth/config";
import type { OAuthTokenResponse } from "@/lib/oauth/types";

const base64UrlEncode = (input: string | Buffer): string => Buffer.from(input).toString("base64url");

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

export async function exchangeCodeForBlueskyToken(
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
    authLogger.error({ platform: "bluesky", status: response.status }, "Token exchange failed after nonce retry");
    throw new Error(`Failed to exchange code for token: ${response.statusText}`);
  }

  return {
    tokenData: await response.json(),
    dpopPublicJwk: publicJwk,
    dpopPrivateJwk: privateJwk,
  };
}

export async function exchangeCodeForToken(
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
  if (platform === "reddit") {
    headers["User-Agent"] = "web:SimplePost:1.0 (https://simplepost.social)";
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
