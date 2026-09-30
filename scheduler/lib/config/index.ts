import { ALL_SOCIAL_PLATFORMS } from "@/components/visual/platforms";
export * from "@/components/visual/platforms";

export const SOCIAL_PLATFORM_IDS = ALL_SOCIAL_PLATFORMS.map((platform) => platform.id);

export function parseEnabledSocialProviderIds(value: string | undefined): Set<string> {
  const configured = (value ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);

  if (configured.includes("*")) return new Set(SOCIAL_PLATFORM_IDS);

  const supported = new Set(SOCIAL_PLATFORM_IDS);
  return new Set(configured.filter((id) => supported.has(id)));
}

const enabledSocialProviderIds = parseEnabledSocialProviderIds(process.env.NEXT_PUBLIC_ENABLED_SOCIAL_PROVIDERS);

/** Providers available for new connections in this deployment. Disabled by default. */
export const SOCIAL_PLATFORMS = ALL_SOCIAL_PLATFORMS.filter((platform) => enabledSocialProviderIds.has(platform.id));

export function isSocialPlatformEnabled(platformId: string): boolean {
  return enabledSocialProviderIds.has(platformId.toLowerCase());
}
