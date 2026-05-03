import type { Platform } from "@simple-post/sdk";

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

export function mapPlatformName(platform: string): Platform {
  return PLATFORM_MAP[platform.toLowerCase()] || (platform.toLowerCase() as Platform);
}

export interface PostUrlContext {
  username?: string;
  platformAccountId?: string;
}

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
      // /p/ URL. The publisher populates `result.url` with the proper
      // permalink; if we get a numeric id here it means the permalink fetch
      // failed and there's no working URL we can construct.
      if (/^\d+$/.test(postId)) return undefined;
      return `https://www.instagram.com/p/${postId}/`;
    }
    case "tiktok": {
      // TikTok's Direct Post API returns a `publish_id` (non-numeric) until
      // the post is fully published. Only a purely-numeric video id yields
      // a working video URL — otherwise fall back to the creator's profile
      // so the user can still navigate to their post.
      const username = ctx.username?.replace("@", "");
      if (!/^\d+$/.test(postId)) return username ? `https://www.tiktok.com/@${username}` : undefined;
      return username ? `https://www.tiktok.com/@${username}/video/${postId}` : undefined;
    }
    case "telegram": {
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
      // LinkedIn's `/ugcPosts` API returns URNs like
      // `urn:li:ugcPost:7456790957989093376`. The public `/feed/update/`
      // URL accepts these URNs directly and redirects to the post — note
      // that ugcPost and activity URNs have DIFFERENT numeric IDs for the
      // same post, so we cannot synthesize an activity URN by swapping the
      // prefix. Colons must stay raw — percent-encoding them breaks the
      // redirect.
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
