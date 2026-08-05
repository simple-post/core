import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { fetchFreshProfilePicture } from "@/lib/oauth/profile-picture";
import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import { BadRequestError, ForbiddenError, handleApiError, NotFoundError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

const SUPPORTED_PLATFORMS = new Set(["x", "linkedin", "threads"]);

function normalizePlatform(platform: string): string {
  return platform.toLowerCase() === "twitter" ? "x" : platform.toLowerCase();
}

function normalizeAvatarUrl(url: string, platform: string): URL {
  const normalizedUrl = new URL(url);
  if (normalizedUrl.protocol === "http:") {
    normalizedUrl.protocol = "https:";
  }

  if (normalizePlatform(platform) === "x") {
    normalizedUrl.pathname = normalizedUrl.pathname.replace("_400x400.", "_normal.");
  }

  return normalizedUrl;
}

function isAllowedAvatarHost(url: URL, platform: string): boolean {
  const host = url.hostname.toLowerCase();
  const platformId = normalizePlatform(platform);

  if (platformId === "x") {
    return host === "pbs.twimg.com" || host === "abs.twimg.com" || host.endsWith(".twimg.com");
  }

  if (platformId === "linkedin") {
    return host === "media.licdn.com" || host.endsWith(".licdn.com");
  }

  if (platformId === "threads") {
    return host === "cdninstagram.com" || host.endsWith(".cdninstagram.com");
  }

  return false;
}

function getAllowedAvatarUrl(value: string | null, platform: string): URL | null {
  if (!value) return null;

  try {
    const url = normalizeAvatarUrl(value, platform);
    return url.protocol === "https:" && isAllowedAvatarHost(url, platform) ? url : null;
  } catch {
    return null;
  }
}

async function fetchAvatar(url: URL | null): Promise<Response | null> {
  if (!url) return null;

  try {
    const response = await fetch(url, { cache: "no-store", redirect: "follow" });
    const contentType = response.headers.get("content-type") ?? "";
    return response.ok && contentType.toLowerCase().startsWith("image/") ? response : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(request, { action: "load_social_account_avatar", connectedAccountId: id });

    const account = await prisma.connectedAccount.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        platform: true,
        profilePicture: true,
        accessToken: true,
        refreshToken: true,
        tokenMetadata: true,
      },
    });

    if (!account) {
      throw new NotFoundError("Account not found");
    }

    if (account.userId !== session.user.id) {
      throw new ForbiddenError("You don't have permission to access this account");
    }

    const platform = normalizePlatform(account.platform);
    if (!SUPPORTED_PLATFORMS.has(platform)) {
      throw new BadRequestError("Avatar proxy is not supported for this platform");
    }

    const storedAvatarUrl = getAllowedAvatarUrl(account.profilePicture, platform);
    if (account.profilePicture && !storedAvatarUrl) {
      throw new BadRequestError("Account profile picture URL is not supported");
    }

    let imageResponse = await fetchAvatar(storedAvatarUrl);

    if (!imageResponse && (platform === "linkedin" || platform === "threads")) {
      const { accessToken } = decryptConnectedAccountSecrets(account);
      const freshProfilePicture = await fetchFreshProfilePicture(platform, accessToken);
      const freshAvatarUrl = getAllowedAvatarUrl(freshProfilePicture, platform);

      imageResponse = await fetchAvatar(freshAvatarUrl);
      if (imageResponse && freshProfilePicture && freshProfilePicture !== account.profilePicture) {
        await prisma.connectedAccount.update({
          where: { id: account.id },
          data: { profilePicture: freshProfilePicture },
        });
      }
    }

    if (!imageResponse) {
      return new NextResponse(null, {
        status: 502,
        headers: {
          "Cache-Control": "private, no-store",
        },
      });
    }

    const contentType = imageResponse.headers.get("content-type") ?? "application/octet-stream";
    return new NextResponse(await imageResponse.arrayBuffer(), {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=300, stale-while-revalidate=86400",
        "Content-Type": contentType,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
