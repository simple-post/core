import axios from "axios";

import { numericFields, pickMetrics, postAnalyticsResult, toFiniteNumber } from "../../utils/analytics";

import type { AccountAnalytics, AnalyticsTarget, PostAnalytics } from "../../analytics";

/** Bluesky's public AppView serves counts without authentication. */
const PUBLIC_APPVIEW = "https://public.api.bsky.app/xrpc";
const REQUEST_TIMEOUT_MS = 15_000;

interface BlueskyPostView {
  uri: string;
  cid?: string;
  author?: { handle?: string; did?: string };
  record?: { createdAt?: string };
  indexedAt?: string;
  [key: string]: unknown;
}

/** The post id SimplePost stores for Bluesky is the at:// uri; older results may store only the uri in platformData. */
export function blueskyUri(target: AnalyticsTarget): string | undefined {
  const candidates = [target.uri, target.platformData?.uri, target.postId];
  return candidates.find((value): value is string => typeof value === "string" && value.startsWith("at://"));
}

function webUrl(post: BlueskyPostView): string | undefined {
  const rkey = post.uri.split("/").at(-1);
  const actor = post.author?.handle ?? post.author?.did;
  return rkey && actor ? `https://bsky.app/profile/${actor}/post/${rkey}` : undefined;
}

export async function fetchBlueskyPostAnalytics(targets: AnalyticsTarget[]): Promise<PostAnalytics[]> {
  const uris = targets.map((target) => blueskyUri(target));
  const requested = [...new Set(uris.flatMap((uri) => (uri ? [uri] : [])))];
  const posts = new Map<string, BlueskyPostView>();

  if (requested.length > 0) {
    const params = new URLSearchParams();
    for (const uri of requested) params.append("uris", uri);
    const response = await axios.get<{ posts?: BlueskyPostView[] }>(`${PUBLIC_APPVIEW}/app.bsky.feed.getPosts`, {
      params,
      timeout: REQUEST_TIMEOUT_MS,
    });
    for (const post of response.data?.posts ?? []) posts.set(post.uri, post);
  }

  return targets.map((target, index) => {
    const uri = uris[index];
    if (!uri) {
      return postAnalyticsResult("bluesky", target.postId, "unsupported", {
        message: "This Bluesky post has no record URI stored, so its counts cannot be read.",
      });
    }
    const post = posts.get(uri);
    if (!post) {
      return postAnalyticsResult("bluesky", target.postId, "not_found", {
        message: "Bluesky did not return this post. It may have been deleted.",
      });
    }
    const counts = post as Record<string, unknown>;
    return postAnalyticsResult("bluesky", target.postId, "ok", {
      metrics: pickMetrics(counts, {
        likeCount: "likes",
        replyCount: "comments",
        repostCount: "shares",
        quoteCount: "quotes",
        bookmarkCount: "saves",
      }),
      platformMetrics: numericFields(counts),
      url: webUrl(post),
      publishedAt: post.record?.createdAt ?? post.indexedAt,
    });
  });
}

export async function fetchBlueskyAccountAnalytics(actor: string): Promise<AccountAnalytics> {
  const response = await axios.get<Record<string, unknown>>(`${PUBLIC_APPVIEW}/app.bsky.actor.getProfile`, {
    params: { actor },
    timeout: REQUEST_TIMEOUT_MS,
  });
  const profile = response.data ?? {};
  const value = (name: string) => toFiniteNumber(profile[name]);
  return {
    platform: "bluesky",
    status: "ok",
    metrics: {
      ...(value("followersCount") === undefined ? {} : { followers: value("followersCount") }),
      ...(value("followsCount") === undefined ? {} : { following: value("followsCount") }),
      ...(value("postsCount") === undefined ? {} : { posts: value("postsCount") }),
    },
    platformMetrics: numericFields(profile),
    fetchedAt: new Date().toISOString(),
  };
}
