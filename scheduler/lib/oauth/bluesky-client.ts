import crypto from "node:crypto";

import { env } from "@/lib/env";

export const BLUESKY_CLIENT_METADATA_PATH = "/oauth/client-metadata.json";
export const BLUESKY_CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

type JsonWebKey = Record<string, unknown>;

interface BlueskyClientKey {
  kid: string;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}

function getAppBaseUrl(): string {
  return env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
}

export function getBlueskyClientId(): string {
  return process.env.BLUESKY_CLIENT_ID || `${getAppBaseUrl()}${BLUESKY_CLIENT_METADATA_PATH}`;
}

export function getBlueskyOAuthIssuer(): string {
  return (process.env.BLUESKY_OAUTH_ISSUER || "https://bsky.social").replace(/\/+$/, "");
}

function getBlueskyClientKey(): BlueskyClientKey | null {
  const encoded = process.env.BLUESKY_CLIENT_PRIVATE_JWK;
  if (!encoded) {
    return null;
  }

  let privateJwk: JsonWebKey;
  try {
    privateJwk = JSON.parse(encoded) as JsonWebKey;
  } catch {
    throw new Error("BLUESKY_CLIENT_PRIVATE_JWK must contain a valid JSON Web Key");
  }

  if (
    privateJwk.kty !== "EC" ||
    privateJwk.crv !== "P-256" ||
    typeof privateJwk.x !== "string" ||
    typeof privateJwk.y !== "string" ||
    typeof privateJwk.d !== "string"
  ) {
    throw new Error("BLUESKY_CLIENT_PRIVATE_JWK must be a private P-256 EC JSON Web Key");
  }

  const privateKey = crypto.createPrivateKey({
    format: "jwk",
    key: privateJwk as crypto.JsonWebKey,
  });
  const exportedPublicJwk = crypto.createPublicKey(privateKey).export({ format: "jwk" }) as JsonWebKey;
  const publicJwk: JsonWebKey = {
    ...exportedPublicJwk,
    alg: "ES256",
    use: "sig",
  };
  const thumbprintInput = JSON.stringify({
    crv: publicJwk.crv,
    kty: publicJwk.kty,
    x: publicJwk.x,
    y: publicJwk.y,
  });
  const kid =
    process.env.BLUESKY_CLIENT_KEY_ID || crypto.createHash("sha256").update(thumbprintInput).digest("base64url");

  return {
    kid,
    privateJwk: { ...privateJwk, alg: "ES256", kid, use: "sig" },
    publicJwk: { ...publicJwk, kid },
  };
}

export function getBlueskyTokenEndpointAuthMethod(): "none" | "private_key_jwt" {
  return getBlueskyClientKey() ? "private_key_jwt" : "none";
}

export function createBlueskyClientAssertion(audience = getBlueskyOAuthIssuer()): string | null {
  const clientKey = getBlueskyClientKey();
  if (!clientKey) {
    return null;
  }

  const clientId = getBlueskyClientId();
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = {
    alg: "ES256",
    kid: clientKey.kid,
    typ: "JWT",
  };
  const payload = {
    aud: audience,
    exp: issuedAt + 120,
    iat: issuedAt,
    iss: clientId,
    jti: crypto.randomUUID(),
    sub: clientId,
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const privateKey = crypto.createPrivateKey({
    format: "jwk",
    key: clientKey.privateJwk as crypto.JsonWebKey,
  });
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    dsaEncoding: "ieee-p1363",
    key: privateKey,
  });

  return `${signingInput}.${signature.toString("base64url")}`;
}

export function addBlueskyClientAuthentication(body: URLSearchParams, audience = getBlueskyOAuthIssuer()): void {
  const assertion = createBlueskyClientAssertion(audience);
  if (!assertion) {
    return;
  }
  body.set("client_assertion_type", BLUESKY_CLIENT_ASSERTION_TYPE);
  body.set("client_assertion", assertion);
}

export function getBlueskyClientMetadata() {
  const baseUrl = getAppBaseUrl();
  const clientKey = getBlueskyClientKey();

  return {
    client_id: getBlueskyClientId(),
    application_type: "web",
    client_name: "SimplePost",
    client_uri: baseUrl,
    logo_uri: `${baseUrl}/simplepost-logo.png`,
    tos_uri: `${baseUrl}/terms`,
    policy_uri: `${baseUrl}/privacy`,
    dpop_bound_access_tokens: true,
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: [`${baseUrl}/api/connect/callback/bluesky`],
    response_types: ["code"],
    scope: "atproto transition:generic",
    token_endpoint_auth_method: clientKey ? "private_key_jwt" : "none",
    ...(clientKey ? { token_endpoint_auth_signing_alg: "ES256", jwks: { keys: [clientKey.publicJwk] } } : {}),
  };
}
