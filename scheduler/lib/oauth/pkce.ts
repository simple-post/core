import type { NextRequest, NextResponse } from "next/server";

import { getEncryptionProvider } from "@/lib/security/encryption";

export async function generatePkce(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = Buffer.from(crypto.randomUUID() + crypto.randomUUID()).toString("base64url");
  const codeChallenge = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier)),
  ).toString("base64url");
  return { codeVerifier, codeChallenge };
}

function cookieName(platform: string): string {
  return `oauth_pkce_${platform}`;
}

export function setPkceCookie(response: NextResponse, codeVerifier: string, platform: string): void {
  const encrypted = getEncryptionProvider().encrypt(codeVerifier);
  response.cookies.set(cookieName(platform), encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/api/connect/callback/${platform}`,
    maxAge: 600, // 10 minutes
  });
}

export function getPkceVerifier(request: NextRequest, platform: string): string | null {
  const cookie = request.cookies.get(cookieName(platform));
  if (!cookie?.value) return null;
  try {
    return getEncryptionProvider().decrypt(cookie.value);
  } catch {
    return null;
  }
}

export function clearPkceCookie(response: NextResponse, platform: string): void {
  response.cookies.set(cookieName(platform), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/api/connect/callback/${platform}`,
    maxAge: 0,
  });
}
