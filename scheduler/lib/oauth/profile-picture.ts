import { authLogger } from "@/lib/logger";

interface LinkedInProfilePictureElement {
  data?: {
    "com.linkedin.digitalmedia.mediaartifact.StillImage"?: {
      storageSize?: { width?: number; height?: number };
    };
  };
  identifiers?: Array<{ identifier?: string }>;
}

interface LinkedInProfileV2 {
  profilePicture?: {
    "displayImage~"?: {
      elements?: LinkedInProfilePictureElement[];
    };
  };
}

function getLinkedInImageArea(element: LinkedInProfilePictureElement): number {
  const storageSize = element.data?.["com.linkedin.digitalmedia.mediaartifact.StillImage"]?.storageSize;
  return (storageSize?.width ?? 0) * (storageSize?.height ?? 0);
}

export function extractLinkedInDecoratedProfilePicture(profile: LinkedInProfileV2): string | null {
  const elements = profile.profilePicture?.["displayImage~"]?.elements ?? [];
  const candidates: Array<{ area: number; identifier: string }> = [];

  for (const element of elements) {
    const area = getLinkedInImageArea(element);
    for (const { identifier } of element.identifiers ?? []) {
      if (identifier) {
        candidates.push({ area, identifier });
      }
    }
  }

  candidates.sort((a, b) => b.area - a.area);
  return candidates[0]?.identifier ?? null;
}

export async function fetchLinkedInProfilePicture(accessToken: string): Promise<string | null> {
  if (!accessToken) return null;

  try {
    const userInfoResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (userInfoResponse.ok) {
      const userInfo = (await userInfoResponse.json()) as { picture?: unknown };
      if (typeof userInfo.picture === "string" && userInfo.picture.length > 0) {
        return userInfo.picture;
      }
    }

    const decoratedResponse = await fetch(
      "https://api.linkedin.com/v2/me?projection=(id,profilePicture(displayImage~digitalmediaAsset:playableStreams))",
      { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!decoratedResponse.ok) {
      authLogger.warn(
        { status: decoratedResponse.status, statusText: decoratedResponse.statusText },
        "Failed to refresh LinkedIn profile picture",
      );
      return null;
    }

    return extractLinkedInDecoratedProfilePicture((await decoratedResponse.json()) as LinkedInProfileV2);
  } catch (error) {
    authLogger.warn({ error }, "Failed to refresh LinkedIn profile picture");
    return null;
  }
}

export async function fetchThreadsProfilePicture(accessToken: string): Promise<string | null> {
  if (!accessToken) return null;

  try {
    const url = new URL("https://graph.threads.net/v1.0/me");
    url.searchParams.set("fields", "threads_profile_picture_url");
    url.searchParams.set("access_token", accessToken);

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      authLogger.warn(
        { status: response.status, statusText: response.statusText },
        "Failed to refresh Threads profile picture",
      );
      return null;
    }

    const profile = (await response.json()) as { threads_profile_picture_url?: unknown };
    return typeof profile.threads_profile_picture_url === "string" && profile.threads_profile_picture_url.length > 0
      ? profile.threads_profile_picture_url
      : null;
  } catch (error) {
    authLogger.warn({ error }, "Failed to refresh Threads profile picture");
    return null;
  }
}

export function fetchFreshProfilePicture(platform: string, accessToken: string): Promise<string | null> {
  if (platform === "linkedin") return fetchLinkedInProfilePicture(accessToken);
  if (platform === "threads") return fetchThreadsProfilePicture(accessToken);
  return Promise.resolve(null);
}
