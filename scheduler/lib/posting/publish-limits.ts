import { mapPlatformName } from "@simple-post/sdk/platform-names";

export const RATE_WINDOW_MS = 60_000;
export const platformLimit = (platform: string) => (mapPlatformName(platform) === "forem" ? 10 : 15);
