import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";
import { ApiError, BadRequestError } from "@/lib/utils/errors";

export const ASSISTANT_CONNECTION_SOURCE = "assistant_handoff" as const;
const MAX_AGE_MS = 60 * 60 * 1000;

function signature(userId: string, platform: string, expiresAt: number): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(JSON.stringify(["social-connection-handoff-v1", userId, platform, expiresAt]))
    .digest("base64url");
}

/** A link binds the browser to the MCP user; it never signs anyone in or grants access. */
export function createConnectionHandoff(userId: string, platform: string): string {
  const expiresAt = Date.now() + MAX_AGE_MS;
  return `${expiresAt}.${signature(userId, platform, expiresAt)}`;
}

export function verifyConnectionHandoff(token: unknown, userId: string, platform: string): void {
  if (typeof token !== "string" || !/^\d{13}\.[\w-]{43}$/.test(token))
    throw new BadRequestError("This connection link is invalid. Ask your AI assistant for a new link.");
  const [expires, signed] = token.split(".");
  const expiresAt = Number(expires);
  if (expiresAt <= Date.now() || expiresAt > Date.now() + MAX_AGE_MS)
    throw new BadRequestError("This connection link has expired. Ask your AI assistant for a new link.");
  const expected = Buffer.from(signature(userId, platform, expiresAt));
  if (!timingSafeEqual(Buffer.from(signed), expected))
    throw new ApiError(
      "Sign in with the SimplePost account connected to your AI assistant, then continue with this connection.",
      403,
      "HANDOFF_ACCOUNT_MISMATCH",
    );
}

export function handoffSource(token: unknown, userId: string, platform: string) {
  if (token === undefined || token === null) return undefined;
  verifyConnectionHandoff(token, userId, platform);
  return ASSISTANT_CONNECTION_SOURCE;
}
