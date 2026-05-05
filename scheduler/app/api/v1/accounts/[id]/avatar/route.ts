import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { BadRequestError, ForbiddenError, handleApiError, NotFoundError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

const SUPPORTED_PLATFORMS = new Set(["x", "twitter", "linkedin"]);

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

  return false;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(request);

    const account = await prisma.connectedAccount.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        platform: true,
        profilePicture: true,
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

    if (!account.profilePicture) {
      throw new NotFoundError("Account profile picture not found");
    }

    const avatarUrl = normalizeAvatarUrl(account.profilePicture, platform);
    if (avatarUrl.protocol !== "https:" || !isAllowedAvatarHost(avatarUrl, platform)) {
      throw new BadRequestError("Account profile picture URL is not supported");
    }

    const imageResponse = await fetch(avatarUrl, { cache: "no-store", redirect: "follow" });
    const contentType = imageResponse.headers.get("content-type") ?? "";

    if (!imageResponse.ok || !contentType.toLowerCase().startsWith("image/")) {
      return new NextResponse(null, {
        status: 502,
        headers: {
          "Cache-Control": "private, no-store",
        },
      });
    }

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
