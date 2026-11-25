import { BlueskyProvider } from "./bluesky";
import { ForemProvider } from "./forem";
import { LinkedInProvider } from "./linkedin";
import { MetaProvider } from "./meta";
import { unsupported } from "./shared";
import { XProvider } from "./x";
import { YouTubeProvider } from "./youtube";

import type {
  SocialActivityAccount,
  SocialActivityCapability,
  SocialActivityPage,
  SocialActivityPostTarget,
  SocialActivityProvider,
  SocialComment,
  SocialLike,
  SocialLikeRequest,
  SocialReply,
  SocialReplyRequest,
} from "../types/social";

const PROVIDERS: Readonly<Record<string, SocialActivityProvider>> = {
  x: new XProvider(),
  facebook: new MetaProvider("facebook"),
  instagram: new MetaProvider("instagram"),
  threads: new MetaProvider("threads"),
  youtube: new YouTubeProvider(),
  bluesky: new BlueskyProvider(),
  linkedin: new LinkedInProvider(),
  forem: new ForemProvider(),
};

function providerKey(platform: string): string {
  const normalized = platform.trim().toLowerCase();
  return normalized === "twitter" ? "x" : normalized;
}

/** Returns undefined for configured publishers without an activity adapter in this version, such as Telegram. */
export function getSocialActivityProvider(platform: string): SocialActivityProvider | undefined {
  const key = providerKey(platform);
  return Object.hasOwn(PROVIDERS, key) ? PROVIDERS[key] : undefined;
}

export function getSocialActivityCapabilities(platform: string): ReadonlySet<SocialActivityCapability> {
  return getSocialActivityProvider(platform)?.getCapabilities() ?? new Set();
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

export async function replyToSocialComment(request: SocialReplyRequest) {
  const provider = getSocialActivityProvider(request.account.platform);
  return provider?.replyToComment
    ? provider.replyToComment(request)
    : unsupported<SocialReply>(request.account.platform, "replies");
}

export async function listSocialPostQuotes(
  account: SocialActivityAccount,
  post: SocialActivityPostTarget,
  options?: { cursor?: string; limit?: number },
) {
  const provider = getSocialActivityProvider(account.platform);
  return provider?.listPostQuotes
    ? provider.listPostQuotes(account, post, options)
    : unsupported<SocialActivityPage<SocialComment>>(account.platform, "quotes");
}

export async function likeSocialItem(request: SocialLikeRequest) {
  const provider = getSocialActivityProvider(request.account.platform);
  return provider?.likeItem ? provider.likeItem(request) : unsupported<SocialLike>(request.account.platform, "likes");
}
