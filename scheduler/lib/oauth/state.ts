import crypto from "node:crypto";

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

export interface OAuthStatePayload {
  userId: string;
  platform: string;
  timestamp: number;
}

function getSigningKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required for OAuth state signing");
  }
  return Buffer.from(secret, "utf8");
}

function hmacSign(data: string): string {
  return crypto.createHmac("sha256", getSigningKey()).update(data).digest("base64url");
}

export function createOAuthState(userId: string, platform: string): string {
  const payload: OAuthStatePayload = {
    userId,
    platform,
    timestamp: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = hmacSign(encoded);
  return `${encoded}.${signature}`;
}

export function verifyOAuthState(state: string): OAuthStatePayload {
  const dotIndex = state.lastIndexOf(".");
  if (dotIndex === -1) {
    throw new OAuthStateError("invalid_state", "Malformed state parameter");
  }

  const encoded = state.slice(0, dotIndex);
  const signature = state.slice(dotIndex + 1);

  const expectedSignature = hmacSign(encoded);

  // Timing-safe comparison
  const sigBuffer = Buffer.from(signature, "base64url");
  const expectedBuffer = Buffer.from(expectedSignature, "base64url");

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    throw new OAuthStateError("invalid_state", "State signature verification failed");
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new OAuthStateError("invalid_state", "Failed to parse state payload");
  }

  if (!payload.userId || !payload.platform || !payload.timestamp) {
    throw new OAuthStateError("invalid_state", "Incomplete state payload");
  }

  const age = Date.now() - payload.timestamp;
  if (age > STATE_MAX_AGE_MS) {
    throw new OAuthStateError("state_expired", "OAuth state has expired");
  }

  return payload;
}

export class OAuthStateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OAuthStateError";
  }
}
