import crypto from "node:crypto";

import { env } from "@/lib/env";

import { getAppBaseUrl } from "./config";

const OIDC_SIGNING_CONTEXT = "simplepost-mcp-oidc-es256-v1";
const ID_TOKEN_LIFETIME_SECONDS = 10 * 60;

interface OidcSigningKey {
  kid: string;
  privateKey: crypto.KeyObject;
  publicJwk: crypto.JsonWebKey & { alg: "ES256"; kid: string; use: "sig" };
}

export interface OidcIdentity {
  email: string;
  emailVerified: boolean;
  name?: string | null;
  userId: string;
}

function derivePrivateScalar(secret: string): Buffer {
  for (let counter = 0; counter < 256; counter += 1) {
    const candidate = crypto
      .createHash("sha256")
      .update(secret)
      .update("\0")
      .update(OIDC_SIGNING_CONTEXT)
      .update(Buffer.from([counter]))
      .digest();

    try {
      const ecdh = crypto.createECDH("prime256v1");
      ecdh.setPrivateKey(candidate);
      return candidate;
    } catch {
      // The P-256 scalar must be in range. Try the next domain-separated value.
    }
  }

  throw new Error("Could not derive a valid OIDC signing key");
}

function getOidcSigningKey(): OidcSigningKey {
  const privateScalar = derivePrivateScalar(env.BETTER_AUTH_SECRET);
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(privateScalar);
  const publicPoint = ecdh.getPublicKey(undefined, "uncompressed");
  const privateJwk: crypto.JsonWebKey = {
    crv: "P-256",
    d: privateScalar.toString("base64url"),
    kty: "EC",
    x: publicPoint.subarray(1, 33).toString("base64url"),
    y: publicPoint.subarray(33, 65).toString("base64url"),
  };
  const privateKey = crypto.createPrivateKey({ format: "jwk", key: privateJwk });
  const exportedPublicJwk = crypto.createPublicKey(privateKey).export({ format: "jwk" });
  const thumbprintInput = JSON.stringify({
    crv: exportedPublicJwk.crv,
    kty: exportedPublicJwk.kty,
    x: exportedPublicJwk.x,
    y: exportedPublicJwk.y,
  });
  const kid = crypto.createHash("sha256").update(thumbprintInput).digest("base64url");

  return {
    kid,
    privateKey,
    publicJwk: {
      ...exportedPublicJwk,
      alg: "ES256",
      kid,
      use: "sig",
    },
  };
}

export function getOidcJwks() {
  return { keys: [getOidcSigningKey().publicJwk] };
}

export function createOidcIdToken(params: {
  clientId: string;
  includeEmail?: boolean;
  identity: OidcIdentity;
  nonce?: string | null;
}): string {
  const signingKey = getOidcSigningKey();
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = {
    alg: "ES256",
    kid: signingKey.kid,
    typ: "JWT",
  };
  const payload = {
    aud: params.clientId,
    ...(params.includeEmail === false
      ? {}
      : { email: params.identity.email, email_verified: params.identity.emailVerified }),
    exp: issuedAt + ID_TOKEN_LIFETIME_SECONDS,
    iat: issuedAt,
    iss: getAppBaseUrl(),
    ...(params.identity.name ? { name: params.identity.name } : {}),
    ...(params.nonce ? { nonce: params.nonce } : {}),
    sub: params.identity.userId,
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    dsaEncoding: "ieee-p1363",
    key: signingKey.privateKey,
  });

  return `${signingInput}.${signature.toString("base64url")}`;
}
