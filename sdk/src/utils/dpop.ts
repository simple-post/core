import crypto from "node:crypto";

import { derToRaw } from "./crypto";

type JsonWebKey = Record<string, unknown>;

export interface DpopProofOptions {
  method: string;
  url: string;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
  accessToken?: string;
  nonce?: string;
}

/** Build an RFC 9449 ES256 DPoP proof for an authenticated Bluesky request. */
export function createDpopProof({ method, url, privateJwk, publicJwk, accessToken, nonce }: DpopProofOptions): string {
  const now = Math.floor(Date.now() / 1000);
  const htu = new URL(url);
  // RFC 9449 defines htu without query and fragment. Request query values can
  // be provider-owned cursors, so including them also makes valid DPoP proofs
  // fail when a server normalizes its request URL.
  htu.search = "";
  htu.hash = "";
  const header = { typ: "dpop+jwt", alg: "ES256", jwk: publicJwk };
  const payload: Record<string, unknown> = {
    htu: htu.toString(),
    htm: method.toUpperCase(),
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 120,
  };
  if (accessToken) payload.ath = crypto.createHash("sha256").update(accessToken).digest("base64url");
  if (nonce) payload.nonce = nonce;
  const signingInput = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  const privateKey = crypto.createPrivateKey({ format: "jwk", key: privateJwk as crypto.JsonWebKey });
  const signature = crypto.sign("sha256", Buffer.from(signingInput), privateKey);
  return `${signingInput}.${Buffer.from(derToRaw(signature)).toString("base64url")}`;
}
