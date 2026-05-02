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
      return `https://www.instagram.com/p/${postId}/`;
    }
    case "tiktok": {
      return `https://www.tiktok.com/@${ctx.username || "user"}/video/${postId}`;
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
      return `https://www.linkedin.com/feed/update/${encodeURIComponent(postId)}`;
    }
    case "pinterest": {
      return `https://www.pinterest.com/pin/${postId}/`;
    }
    default: {
      return undefined;
    }
  }
}
