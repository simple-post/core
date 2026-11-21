import { authLogger } from "@/lib/logger";
import { OAuthCallbackError } from "@/lib/oauth/errors";

interface YouTubeChannel {
  id?: string;
  snippet?: {
    title?: string;
    customUrl?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
}

interface YouTubeChannelList {
  items?: YouTubeChannel[];
  nextPageToken?: string;
}

/** Resolve the channel authorized by this token, including a selected Brand Account. */
export async function fetchYouTubeChannel(accessToken: string) {
  let data: YouTubeChannelList;
  try {
    const response = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=2", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      authLogger.warn({ status: response.status }, "Failed to fetch authorized YouTube channel");
      throw new Error("YouTube channel lookup failed");
    }
    data = (await response.json()) as YouTubeChannelList;
  } catch {
    // Provider bodies and network errors can contain credentials. Keep the callback error safe to log.
    throw new OAuthCallbackError("profile_fetch_failed", "Failed to fetch authorized YouTube channel");
  }

  if (!Array.isArray(data?.items) || data.items.length === 0) {
    throw new OAuthCallbackError("youtube_no_channel", "No authorized YouTube channel was returned");
  }
  // Uploads act as the token's channel. Never choose the first of several channels arbitrarily.
  if (data.items.length !== 1 || data.nextPageToken) {
    throw new OAuthCallbackError("youtube_ambiguous_channel", "YouTube channel authorization was ambiguous");
  }
  const channel = data.items[0];
  if (typeof channel?.id !== "string" || !channel.id.trim()) {
    throw new OAuthCallbackError("profile_fetch_failed", "YouTube channel lookup did not return a channel ID");
  }
  const snippet = channel.snippet;
  return {
    platformAccountId: channel.id,
    displayName: snippet?.title || null,
    username: snippet?.customUrl?.replace(/^@/, "") || null,
    profilePicture:
      snippet?.thumbnails?.high?.url || snippet?.thumbnails?.medium?.url || snippet?.thumbnails?.default?.url || null,
  };
}
