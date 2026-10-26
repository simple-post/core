import { OAuthAccountProvider, fetchJson, type OAuthProviderDependencies } from "./oauth.js";

interface YouTubeChannelList {
  items?: {
    id?: string;
    snippet?: { title?: string; customUrl?: string };
  }[];
  nextPageToken?: string;
}

async function fetchYouTubeChannel(
  accessToken: string,
): Promise<{ displayName?: string; userId: string; username?: string }> {
  const response = await fetchJson<YouTubeChannelList>(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=2",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    },
    "YouTube channel lookup",
  );

  if (!Array.isArray(response?.items) || response.items.length === 0) {
    throw new Error(
      "No YouTube channel was authorized. Connect again and select the Google account or Brand Account that owns your channel. YouTube Studio invitations alone do not grant API access.",
    );
  }
  if (response.items.length !== 1 || response.nextPageToken) {
    throw new Error(
      "Could not identify a single YouTube channel. Connect again and select a specific channel or Brand Account.",
    );
  }
  const channel = response.items[0];
  if (typeof channel?.id !== "string" || !channel.id.trim()) {
    throw new Error("YouTube channel lookup did not return a channel ID.");
  }

  return {
    displayName: channel.snippet?.title,
    userId: channel.id,
    username: channel.snippet?.customUrl?.replace(/^@/, ""),
  };
}

export class YouTubeAuthProvider extends OAuthAccountProvider {
  public constructor(dependencies?: OAuthProviderDependencies) {
    super(
      "youtube",
      {
        async completeLogin({ tokenSet }) {
          return fetchYouTubeChannel(tokenSet.accessToken);
        },
      },
      dependencies,
    );
  }
}
