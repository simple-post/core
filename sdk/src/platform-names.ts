/**
 * Platform name aliasing and public post URL construction, shared by every
 * SimplePost surface (HTTP server, scheduler, MCP). Browser-safe: no Node
 * imports.
 */

import type { Platform } from "./types/post";

const PLATFORM_MAP: Record<string, Platform> = {
  x: "x",
  twitter: "x",
  youtube: "youtube",
  telegram: "telegram",
  facebook: "facebook",
  instagram: "instagram",
  tiktok: "tiktok",
  bluesky: "bluesky",
  threads: "threads",
  linkedin: "linkedin",
  pinterest: "pinterest",
};

/** Maps stored platform names (including aliases like "twitter") to SDK platform ids. */
export function mapPlatformName(platform: string): Platform {
  return PLATFORM_MAP[platform.toLowerCase()] || (platform.toLowerCase() as Platform);
}

/**
 * Platforms where SimplePost can issue a native repost/reshare of an
 * already-published post (retweet, Bluesky repost, Threads repost, LinkedIn
 * reshare). Lives here — rather than in the Zod-based types/api module — so
 * browser bundles can import it without pulling in the Node-only parts of the
 * SDK barrel (e.g. the S3/`node:fs` utilities).
 */
export const REPOST_CAPABLE_PLATFORMS = ["x", "bluesky", "threads", "linkedin"] as const;
export type RepostCapablePlatform = (typeof REPOST_CAPABLE_PLATFORMS)[number];

export function isRepostCapablePlatform(platform: string): platform is RepostCapablePlatform {
  return (REPOST_CAPABLE_PLATFORMS as readonly string[]).includes(platform);
}

export interface PostUrlContext {
  username?: string;
  platformAccountId?: string;
}

/**
 * Builds the public URL for a published post from its platform post id.
 * Returns undefined when no working public URL can be constructed — callers
 * should prefer a permalink returned by the publisher when available.
 */
export function generatePostUrl(platform: string, postId: string, ctx: PostUrlContext = {}): string | undefined {
  const platformLower = platform.toLowerCase();

  switch (platformLower) {
    case "youtube": {
      return `https://www.youtube.com/watch?v=${postId}`;
    }
    case "x":
    case "twitter": {
      const username = ctx.username || ctx.platformAccountId || "";
      return username ? `https://x.com/${username.replace("@", "")}/status/${postId}` : undefined;
    }
    case "facebook": {
      const pageId = ctx.platformAccountId || "";
      return pageId ? `https://www.facebook.com/${pageId}/posts/${postId}` : undefined;
    }
    case "instagram": {
      // Instagram public URLs require an opaque shortcode (e.g. `DX44yisCEr5`).
      // The Graph API returns a numeric media id which is NOT usable in the
      // /p/ URL — `instagram.com/p/{numericId}/` returns a 404. The publisher
      // populates `result.url` with the proper permalink; if we end up here
      // with a numeric id it means the permalink fetch failed and there's no
      // working URL we can construct.
      if (/^\d+$/.test(postId)) return undefined;
      return `https://www.instagram.com/p/${postId}/`;
    }
    case "tiktok": {
      // TikTok's Direct Post API returns a `publish_id` like
      // `v_pub_file~v2-1.7635755340554061846` immediately; the real numeric
      // video id is only available after the publish-status poll completes,
      // and for unaudited apps the post is routed to the creator's inbox and
      // no public id ever exists. The video id can never be synthesized from
      // the publish_id, so fall back to the creator's profile URL when only
      // a publish_id is available — the user can still navigate to their
      // post from there.
      const username = ctx.username?.replace("@", "");
      if (!/^\d+$/.test(postId)) return username ? `https://www.tiktok.com/@${username}` : undefined;
      return username ? `https://www.tiktok.com/@${username}/video/${postId}` : undefined;
    }
    case "telegram": {
      // Telegram only has public post URLs for public channels (@-handles).
      const chatId = ctx.platformAccountId || "";
      if (chatId.startsWith("@")) {
        return `https://t.me/${chatId.replace("@", "")}/${postId}`;
      }
      return undefined;
    }
    case "bluesky": {
      if (postId.startsWith("at://")) {
        const parts = postId.split("/");
        const recordKey = parts.at(-1);
        if (!recordKey) return undefined;
        const handleOrDid = ctx.username || ctx.platformAccountId || "";
        return handleOrDid ? `https://bsky.app/profile/${handleOrDid.replace("@", "")}/post/${recordKey}` : undefined;
      }
      return undefined;
    }
    case "threads": {
      const username = ctx.username || "";
      return username ? `https://www.threads.net/@${username.replace("@", "")}/post/${postId}` : undefined;
    }
    case "linkedin": {
      // The LinkedIn `/ugcPosts` API returns URNs like
      // `urn:li:ugcPost:7456790957989093376` (or `urn:li:share:...`).
      // LinkedIn's `/feed/update/` URL accepts these URNs as-is and
      // redirects to the actual post page — note that ugcPost and activity
      // URNs have DIFFERENT numeric IDs for the same post, so we cannot
      // synthesize an activity URN by swapping the prefix; we have to pass
      // through whatever the API gave us. Colons must stay raw —
      // percent-encoding them breaks LinkedIn's redirect.
      return `https://www.linkedin.com/feed/update/${postId}`;
    }
    case "pinterest": {
      return `https://www.pinterest.com/pin/${postId}/`;
    }
    default: {
      return undefined;
    }
  }
}
