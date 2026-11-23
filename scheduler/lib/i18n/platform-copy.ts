import type { MessageKey } from "./translate";

const descriptions: Partial<Record<string, MessageKey>> = {
  x: "platformPostX",
  youtube: "platformPostYouTube",
  instagram: "platformPostInstagram",
  facebook: "platformPostFacebook",
  tiktok: "platformPostTikTok",
  bluesky: "platformPostBluesky",
  threads: "platformPostThreads",
  linkedin: "platformPostLinkedIn",
  pinterest: "platformPostPinterest",
  telegram: "platformPostTelegram",
  forem: "platformPostForem",
};

export function platformDescriptionKey(platformId: string) {
  return descriptions[platformId];
}
