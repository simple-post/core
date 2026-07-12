import { BlueskyAuthProvider } from "./bluesky.js";
import { FacebookAuthProvider } from "./facebook.js";
import { InstagramAuthProvider } from "./instagram.js";
import { LinkedInAuthProvider } from "./linkedin.js";
import { PinterestAuthProvider } from "./pinterest.js";
import { SlackAuthProvider } from "./slack.js";
import { TelegramAuthProvider } from "./telegram.js";
import { ThreadsAuthProvider } from "./threads.js";
import { TikTokAuthProvider } from "./tiktok.js";
import { XAuthProvider } from "./x.js";
import { YouTubeAuthProvider } from "./youtube.js";

import type { AuthProvider } from "./provider.js";
import type { AccountPlatform } from "../account/platforms.js";

const AUTH_PROVIDERS = {
  x: new XAuthProvider(),
  youtube: new YouTubeAuthProvider(),
  facebook: new FacebookAuthProvider(),
  instagram: new InstagramAuthProvider(),
  tiktok: new TikTokAuthProvider(),
  bluesky: new BlueskyAuthProvider(),
  threads: new ThreadsAuthProvider(),
  linkedin: new LinkedInAuthProvider(),
  pinterest: new PinterestAuthProvider(),
  slack: new SlackAuthProvider(),
  telegram: new TelegramAuthProvider(),
} satisfies Record<AccountPlatform, AuthProvider>;

export function getAuthProvider(platform: AccountPlatform): AuthProvider {
  return AUTH_PROVIDERS[platform];
}
