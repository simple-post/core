import { refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import { BadRequestError, NotFoundError } from "@/lib/utils/errors";

interface YouTubeResource {
  id: string;
  snippet?: {
    channelId?: string;
    title?: string;
    [key: string]: unknown;
  };
  status?: Record<string, unknown>;
  contentDetails?: Record<string, unknown>;
  fileDetails?: Record<string, unknown>;
  processingDetails?: Record<string, unknown>;
}
interface YouTubeList {
  items?: YouTubeResource[];
  nextPageToken?: string;
}

async function ownerClient(userId: string, accountId: string) {
  const stored = await prisma.connectedAccount.findFirst({ where: { id: accountId, userId } });
  if (!stored) throw new NotFoundError("Account not found");
  if (stored.platform.toLowerCase() !== "youtube") throw new BadRequestError("A YouTube account is required");
  const refreshed = await refreshConnectedAccountIfNeeded(decryptConnectedAccountSecrets(stored));
  if (refreshed.error) throw new BadRequestError(refreshed.error);
  const get = async (
    resource: "channels" | "playlists" | "videos" | "playlistItems",
    params: Record<string, string>,
  ): Promise<YouTubeList> => {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${refreshed.account.accessToken}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new BadRequestError(
        `YouTube readback failed (${response.status}). Check the connected account's read permissions.`,
      );
    return response.json() as Promise<YouTubeList>;
  };
  return { get };
}

/** Returns provider data, never stored post options or account credentials. */
export async function getYouTubeLibrary(userId: string, accountId: string, pageToken?: string) {
  if (pageToken && pageToken.length > 512) throw new BadRequestError("Invalid page token");
  const { get } = await ownerClient(userId, accountId);
  const [channels, playlists] = await Promise.all([
    get("channels", { part: "snippet", mine: "true", maxResults: "50" }),
    get("playlists", { part: "snippet", mine: "true", maxResults: "50", ...(pageToken ? { pageToken } : {}) }),
  ]);
  const channelIds = new Set((channels.items ?? []).map((item) => item.id));
  return {
    channels: (channels.items ?? []).map((item) => ({ id: item.id, title: item.snippet?.title })),
    playlists: (playlists.items ?? [])
      .filter((item) => channelIds.has(item.snippet?.channelId ?? ""))
      .map((item) => ({ id: item.id, title: item.snippet?.title })),
    nextPageToken: playlists.nextPageToken,
  };
}

export async function getYouTubeVideo(userId: string, accountId: string, videoId: string, playlistId?: string) {
  if (!/^[\w-]{11}$/.test(videoId)) throw new BadRequestError("Invalid YouTube video ID");
  if (playlistId && !/^[\w-]{1,150}$/.test(playlistId)) throw new BadRequestError("Invalid YouTube playlist ID");
  const { get } = await ownerClient(userId, accountId);
  const channels = await get("channels", { part: "id", mine: "true", maxResults: "50" });
  const channelIds = new Set((channels.items ?? []).map((item) => item.id));
  const data = await get("videos", {
    part: "snippet,status,contentDetails,fileDetails,processingDetails",
    id: videoId,
  });
  const video = data.items?.find((item) => item.id === videoId && channelIds.has(item.snippet?.channelId ?? ""));
  if (!video) throw new NotFoundError("Video not found on this connected YouTube channel");
  if (!playlistId) return { video };
  const playlists = await get("playlists", { part: "snippet", id: playlistId });
  if (!playlists.items?.some((item) => item.id === playlistId && channelIds.has(item.snippet?.channelId ?? "")))
    throw new NotFoundError("Playlist not found on this connected YouTube channel");
  const items = await get("playlistItems", { part: "contentDetails", playlistId, videoId, maxResults: "50" });
  return { video, playlistItems: items.items ?? [] };
}
