import { BlueskyProvider } from "./bluesky";
import { ForemProvider } from "./forem";
import { LinkedInProvider } from "./linkedin";
import { MetaProvider } from "./meta";
import { PinterestProvider } from "./pinterest";
import { unsupported } from "./shared";
import { TikTokProvider } from "./tiktok";
import { XProvider } from "./x";
import { YouTubeProvider } from "./youtube";

import type {
  SocialActivityAccount,
  SocialActivityCapability,
  SocialActivityPage,
  SocialActivityPostTarget,
  SocialActivityProvider,
  SocialComment,
  SocialMention,
  SocialPostMetrics,
  SocialReply,
  SocialReplyRequest,
} from "../types/social";

const PROVIDERS: Readonly<Record<string, SocialActivityProvider>> = {
  x: new XProvider(),
  facebook: new MetaProvider("facebook"),
  instagram: new MetaProvider("instagram"),
  threads: new MetaProvider("threads"),
  youtube: new YouTubeProvider(),
  tiktok: new TikTokProvider(),
  bluesky: new BlueskyProvider(),
  pinterest: new PinterestProvider(),
  linkedin: new LinkedInProvider(),
  forem: new ForemProvider(),
};

function providerKey(platform: string): string {
  const normalized = platform.trim().toLowerCase();
  return normalized === "twitter" ? "x" : normalized;
}

/** Returns undefined for configured publishers without an activity adapter in this version, such as Telegram. */
export function getSocialActivityProvider(platform: string): SocialActivityProvider | undefined {
  return PROVIDERS[providerKey(platform)];
}

export function getSocialActivityCapabilities(platform: string): ReadonlySet<SocialActivityCapability> {
  return getSocialActivityProvider(platform)?.getCapabilities() ?? new Set();
}

export async function getSocialPostMetrics(account: SocialActivityAccount, post: SocialActivityPostTarget) {
  const provider = getSocialActivityProvider(account.platform);
  return provider?.getPostMetrics
    ? provider.getPostMetrics(account, post)
    : unsupported<SocialPostMetrics>(account.platform, "metrics");
}

export async function listSocialPostComments(
  account: SocialActivityAccount,
  post: SocialActivityPostTarget,
  options?: { cursor?: string; limit?: number },
) {
  const provider = getSocialActivityProvider(account.platform);
  return provider?.listPostComments
    ? provider.listPostComments(account, post, options)
    : unsupported<SocialActivityPage<SocialComment>>(account.platform, "comments");
}

export async function listSocialMentions(
  account: SocialActivityAccount,
  options?: { cursor?: string; limit?: number },
) {
  const provider = getSocialActivityProvider(account.platform);
  return provider?.listMentions
    ? provider.listMentions(account, options)
    : unsupported<SocialActivityPage<SocialMention>>(account.platform, "mentions");
}

export async function replyToSocialComment(request: SocialReplyRequest) {
  const provider = getSocialActivityProvider(request.account.platform);
  return provider?.replyToComment
    ? provider.replyToComment(request)
    : unsupported<SocialReply>(request.account.platform, "replies");
}
